#!/usr/bin/env node
// One command for the whole security test suite: `npm test`.
//
// 1. Guard: the database must be local and its name must end in _test.
//    Only TEST_* variables are read from the outer environment; every child
//    process gets an explicit environment with dummy values only.
// 2. Prepare the database: recreate the public schema, mirror the Supabase
//    API role grants (so it is as exposed as production is today), create
//    the schema with scripts/lib/migrations.mjs.
// 3. Run the "before lockdown" checks, then apply the lockdown file.
// 4. Build the app (next build), start the Supabase Auth stub and two app
//    servers (one with CRON_SECRET, one without), run the tests, tear down.
//
// Options (environment): TEST_DATABASE_URL, TEST_APP_PORT, TEST_AUTH_PORT,
// TEST_SKIP_BUILD=1 (reuse the last build), TEST_FILES (space separated list).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  assertSafeTestDatabase,
  testConfig,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SUPABASE_ANON_KEY,
} from "./helpers/config.mjs";
import { startAuthStub } from "./helpers/auth-stub.mjs";
import { applySchema, applyLockdown, lockdownFileExists, LOCKDOWN_FILE } from "../scripts/lib/migrations.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(here, ".output");
const log = (...a) => console.log("[test runner]", ...a);

const cfg = testConfig();
const target = assertSafeTestDatabase(cfg.databaseUrl);
log(`database: ${target.host}:${target.port}/${target.database} (guard passed)`);

// Next.js loads .env files from the project folder on its own. Refuse to run
// if any exist, so the app under test can only see the environment we pass.
const envFiles = readdirSync(root).filter((f) => f.startsWith(".env") && f !== ".env.example");
if (envFiles.length) {
  console.error(`Refusing to run: found ${envFiles.join(", ")} in the project folder. Move it away first.`);
  process.exit(2);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const networkLog = path.join(outDir, "network.jsonl");
const responseLog = path.join(outDir, "responses.jsonl");
writeFileSync(networkLog, "");
writeFileSync(responseLog, "");

const cronSecret = randomBytes(24).toString("hex");
const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: "C.UTF-8",
  TZ: "UTC",
  NEXT_TELEMETRY_DISABLED: "1",
};
const appEnv = {
  ...baseEnv,
  DATABASE_URL: cfg.databaseUrl,
  NEXT_PUBLIC_SUPABASE_URL: cfg.authUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: cfg.appUrl,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  CRON_SECRET: cronSecret,
  TEST_NETWORK_LOG: networkLog,
  NODE_OPTIONS: `--require ${path.join(here, "helpers", "no-network.cjs")}`,
};
const testEnv = {
  ...baseEnv,
  TEST_DATABASE_URL: cfg.databaseUrl,
  TEST_APP_URL: cfg.appUrl,
  TEST_NOCRON_URL: cfg.noCronUrl,
  TEST_AUTH_URL: cfg.authUrl,
  TEST_CRON_SECRET: cronSecret,
  TEST_NETWORK_LOG: networkLog,
  TEST_RESPONSE_LOG: responseLog,
  TEST_REPO_ROOT: root,
};

const children = [];
let stub;
let sql;

async function connect() {
  const client = postgres(cfg.databaseUrl, { prepare: false, max: 2, onnotice: () => {}, connect_timeout: 5 });
  await client`select 1`;
  return client;
}

async function prepareDatabase() {
  try {
    sql = await connect();
  } catch (err) {
    if (err.code !== "ECONNREFUSED") throw err;
    log("database not reachable, running tests/db-bootstrap.sh");
    const r = spawnSync("bash", [path.join(here, "db-bootstrap.sh")], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("db-bootstrap.sh failed");
    sql = await connect();
  }
  const roles = await sql`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')`;
  if (roles.length !== 3) {
    throw new Error("Roles anon, authenticated and service_role are missing: run bash tests/db-bootstrap.sh");
  }
  // Start from an empty public schema every run.
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON SCHEMA public TO CURRENT_USER;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);
  const unowned = await applySchema(sql);
  log(`schema created (${unowned.length} tables with unowned rows)`);
}

// Async on purpose: the auth stub lives in this process and must keep
// answering while the tests run.
function runNode(args, env, label) {
  log(`running ${label}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function startServer(port, extraEnv, name) {
  const env = { ...appEnv, ...extraEnv, PORT: String(port) };
  const child = spawn(
    process.execPath,
    [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  const file = path.join(outDir, `${name}.log`);
  const chunks = [];
  child.stdout.on("data", (d) => chunks.push(d));
  child.stderr.on("data", (d) => chunks.push(d));
  child.on("exit", () => writeFileSync(file, Buffer.concat(chunks)));
  child.flushLog = () => writeFileSync(file, Buffer.concat(chunks));
  children.push(child);
  return child;
}

async function waitForHttp(url, maxMs = 60_000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await res.text();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`server at ${url} did not start`);
}

async function teardown() {
  for (const c of children) {
    try {
      c.flushLog?.();
      process.kill(-c.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  if (stub) await new Promise((r) => stub.server.close(r));
  if (sql) await sql.end({ timeout: 5 });
}

async function main() {
  await prepareDatabase();

  const preFiles = readdirSync(path.join(here, "pre-lockdown"))
    .filter((f) => f.endsWith(".test.mjs"))
    .sort()
    .map((f) => path.join("tests", "pre-lockdown", f));
  const preStatus = await runNode(["--test", "--test-concurrency=1", ...preFiles], testEnv, "checks before the lockdown");

  if (lockdownFileExists()) {
    await applyLockdown(sql);
    log("lockdown applied");
  } else {
    log(`lockdown file missing (${LOCKDOWN_FILE}); the lockdown tests will fail`);
  }

  if (process.env.TEST_SKIP_BUILD === "1" && existsSync(path.join(root, ".next", "BUILD_ID"))) {
    log("TEST_SKIP_BUILD=1: reusing the existing build");
  } else {
    log("building the app (output in tests/.output/build.log)");
    const r = spawnSync(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], {
      cwd: root,
      env: { ...appEnv, NODE_OPTIONS: "" },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(path.join(outDir, "build.log"), (r.stdout || "") + (r.stderr || ""));
    if (r.status !== 0) {
      console.error((r.stdout || "").slice(-3000), (r.stderr || "").slice(-3000));
      throw new Error("next build failed");
    }
  }

  stub = await startAuthStub(cfg.authPort);
  log(`auth stub on ${cfg.authUrl}`);
  startServer(cfg.appPort, {}, "app");
  startServer(cfg.noCronPort, { CRON_SECRET: "" }, "app-nocron");
  await waitForHttp(`${cfg.appUrl}/api/auth/me`);
  await waitForHttp(`${cfg.noCronUrl}/api/auth/me`);
  log(`app on ${cfg.appUrl}, app without CRON_SECRET on ${cfg.noCronUrl}`);

  const files = process.env.TEST_FILES
    ? process.env.TEST_FILES.split(/\s+/).filter(Boolean)
    : readdirSync(here)
        .filter((f) => /^t\d\d.*\.test\.mjs$/.test(f))
        .sort()
        .map((f) => path.join("tests", f));
  const status = await runNode(
    ["--test", "--test-concurrency=1", "--test-timeout=600000", ...files],
    testEnv,
    `${files.length} test files`
  );
  return preStatus === 0 && status === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error("[test runner] failed:", err.message);
  code = 1;
} finally {
  await teardown();
}
log(code === 0 ? "ALL PASSED" : "FAILURES (see above)");
process.exit(code);
