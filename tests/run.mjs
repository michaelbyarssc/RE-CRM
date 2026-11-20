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
// 4. Build the app (next build, with no encryption key), start the Supabase
//    Auth stub and three app servers (the main one; one without CRON_SECRET;
//    one without SETTINGS_ENCRYPTION_KEY), run the tests, tear down.
// 5. Scan every server log, the build log, the network log and the response
//    log for the ZZSECRET marker that every dummy secret carries and for the
//    run's encryption key, and the server logs for stored ciphertext. Any hit
//    fails the run.
//
// Each run makes a new random encryption key: the app servers get it as
// SETTINGS_ENCRYPTION_KEY, the tests as TEST_SETTINGS_ENCRYPTION_KEY.
//
// Options (environment): TEST_DATABASE_URL, TEST_APP_PORT, TEST_AUTH_PORT,
// TEST_SKIP_BUILD=1 (reuse the last build), TEST_FILES (space separated list),
// TEST_BROWSER (see below).
//
// Browser checks (t33) need Playwright and its Chromium, which are not
// dependencies of the app and are never downloaded. This runner decides
// once whether they run, by really starting the browser and closing it
// again (helpers/browser.mjs). TEST_BROWSER=1: they must run (the run fails
// if the browser cannot start); TEST_BROWSER=0: skip them; unset: run them
// when the browser starts, skip with a note when it does not.
//
// The TEST processes (not the app) get the decision, plus what Playwright
// needs to find the same browser: NODE_PATH, PLAYWRIGHT_BROWSERS_PATH,
// XDG_CACHE_HOME and LOCALAPPDATA when set (HOME is passed anyway). t33
// never decides again: when this runner said "run" and the browser does not
// start there, t33 fails. t33 reports back what it really did, and the
// closing line "browser checks: ..." is made from that report, so "RAN"
// means that every browser check was started with a running browser.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  assertConnectedToTestDatabase,
  assertSafeTestDatabase,
  testConfig,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SUPABASE_ANON_KEY,
} from "./helpers/config.mjs";
import { startAuthStub } from "./helpers/auth-stub.mjs";
import { browserEnvForTests, decideBrowserChecks } from "./helpers/browser.mjs";
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
// The tests write this file to switch on the stand-in for Google's token
// endpoint (see helpers/no-network.cjs) and remove it afterwards.
const googleStubFile = path.join(outDir, "google-token-stub.json");
const LEAK_MARKER = "ZZSECRET";

const cronSecret = randomBytes(24).toString("hex");
const settingsKey = randomBytes(32).toString("base64");
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
  SETTINGS_ENCRYPTION_KEY: settingsKey,
  TEST_NETWORK_LOG: networkLog,
  TEST_GOOGLE_STUB_FILE: googleStubFile,
  NODE_OPTIONS: `--require ${path.join(here, "helpers", "no-network.cjs")}`,
};
// Decided once, here, by starting the browser (see helpers/browser.mjs).
const browser = await decideBrowserChecks(process.env.TEST_BROWSER);
// t33 writes here what it really did. The closing line is made from it.
const browserResultFile = path.join(outDir, "browser-checks.json");
// Where the run stands for the browser checks: "stopped" before the tests
// start, then "selected" or "not selected" (t33 in the list of files or not).
let browserPlan = "stopped";
const testEnv = {
  ...baseEnv,
  // Only for the test processes: the decision, and what Playwright needs.
  ...browserEnvForTests(browser),
  TEST_BROWSER_RESULT_FILE: browserResultFile,
  TEST_DATABASE_URL: cfg.databaseUrl,
  TEST_APP_URL: cfg.appUrl,
  TEST_NOCRON_URL: cfg.noCronUrl,
  TEST_NOKEY_URL: cfg.noKeyUrl,
  TEST_AUTH_URL: cfg.authUrl,
  TEST_CRON_SECRET: cronSecret,
  TEST_SETTINGS_ENCRYPTION_KEY: settingsKey,
  TEST_NETWORK_LOG: networkLog,
  TEST_GOOGLE_STUB_FILE: googleStubFile,
  TEST_RESPONSE_LOG: responseLog,
  TEST_SERVER_LOG_DIR: outDir,
  TEST_REPO_ROOT: root,
};

const children = [];
let stub;
let sql;

async function connect() {
  const client = postgres(cfg.databaseUrl, { prepare: false, max: 2, onnotice: () => {}, connect_timeout: 5 });
  await client`select 1`;
  // Ask the server itself, before anything is changed.
  await assertConnectedToTestDatabase(client);
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

// A variable set to undefined in extraEnv is left out of the server's environment.
function startServer(port, extraEnv, name) {
  const env = Object.fromEntries(
    Object.entries({ ...appEnv, ...extraEnv, PORT: String(port) }).filter(([, v]) => v !== undefined)
  );
  const child = spawn(
    process.execPath,
    [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  // Written as it arrives, so tests can read the server log while it runs
  // (TEST_SERVER_LOG_DIR/<name>.log).
  const file = path.join(outDir, `${name}.log`);
  writeFileSync(file, "");
  child.stdout.on("data", (d) => appendFileSync(file, d));
  child.stderr.on("data", (d) => appendFileSync(file, d));
  child.exited = new Promise((resolve) => child.on("exit", resolve));
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
      process.kill(-c.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  await Promise.race([
    Promise.all(children.map((c) => c.exited)),
    new Promise((r) => setTimeout(r, 10_000)),
  ]);
  if (stub) await new Promise((r) => stub.server.close(r));
  if (sql) await sql.end({ timeout: 5 });
  rmSync(googleStubFile, { force: true });
}

// Leak scan, after the servers have stopped. Prints file and line numbers,
// never the line. Fails the run when:
// - any server log, the build log, the network log or the response log
//   contains LEAK_MARKER (every dummy secret carries it) or the run's own
//   encryption key (the exact base64 text);
// - any SERVER log contains stored ciphertext (enc:v<digits>:).
function scanLogsForLeaks() {
  const files = readdirSync(outDir).filter(
    (f) => f.endsWith(".log") || f === path.basename(networkLog) || f === path.basename(responseLog)
  );
  const isServerLog = (f) => /^app.*\.log$/.test(f);
  const checks = [
    { what: LEAK_MARKER, applies: () => true, test: (line) => line.includes(LEAK_MARKER) },
    { what: "the run's encryption key", applies: () => true, test: (line) => line.includes(settingsKey) },
    { what: "stored ciphertext (enc:v<N>:)", applies: isServerLog, test: (line) => /enc:v\d+:/.test(line) },
  ];
  let ok = true;
  for (const check of checks) {
    const hits = [];
    for (const f of files.filter(check.applies)) {
      readFileSync(path.join(outDir, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (check.test(line)) hits.push(`${f} line ${i + 1}`);
        });
    }
    if (hits.length) {
      console.error(`[test runner] leak scan: ${check.what} found in ${hits.join(", ")}`);
      ok = false;
    }
  }
  if (ok) {
    log(`leak scan: no ${LEAK_MARKER}, no encryption key and no server-log ciphertext in ${files.join(", ")}`);
  }
  return ok;
}

// What really happened with the browser checks, for the closing line.
// "RAN" only when t33 reports a started browser and that every check began.
function browserOutcome() {
  if (!browser.run) {
    const word = browser.required ? "could NOT run" : "SKIPPED";
    return { ok: !browser.required, line: `browser checks: ${word} (${browser.reason})` };
  }
  if (browserPlan === "stopped") return { ok: true, line: "browser checks: did NOT run (the run stopped before the tests)" };
  if (browserPlan === "not selected") return { ok: true, line: "browser checks: did NOT run (t33 is not in TEST_FILES)" };
  let said = null;
  try {
    said = JSON.parse(readFileSync(browserResultFile, "utf8"));
  } catch {
    // t33 wrote no report
  }
  if (said && said.browserStarted && said.checksPlanned > 0 && said.checksStarted === said.checksPlanned) {
    return { ok: true, line: `browser checks: RAN in t33 (all ${said.checksPlanned} checks, Chromium ${said.version}); their results are above` };
  }
  const why = !said
    ? "t33 wrote no report"
    : !said.browserStarted
      ? "the browser did not start in the test process"
      : `only ${said.checksStarted} of ${said.checksPlanned} checks started`;
  return { ok: false, line: `browser checks: did NOT run as the runner planned (${why})` };
}

async function main() {
  if (browser.required && !browser.run) {
    throw new Error(`TEST_BROWSER=1 but the browser checks cannot run: ${browser.reason}`);
  }
  log(browser.run ? `browser checks: will run (${browser.reason})` : `browser checks: will be skipped (${browser.reason})`);
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
      // No encryption key at build time: the key must only be read when used.
      env: Object.fromEntries(
        Object.entries({ ...appEnv, NODE_OPTIONS: "" }).filter(([k]) => k !== "SETTINGS_ENCRYPTION_KEY")
      ),
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
  startServer(cfg.noKeyPort, { SETTINGS_ENCRYPTION_KEY: undefined }, "app-nokey");
  await waitForHttp(`${cfg.appUrl}/api/auth/me`);
  await waitForHttp(`${cfg.noCronUrl}/api/auth/me`);
  await waitForHttp(`${cfg.noKeyUrl}/api/auth/me`);
  log(`app on ${cfg.appUrl}, without CRON_SECRET on ${cfg.noCronUrl}, without SETTINGS_ENCRYPTION_KEY on ${cfg.noKeyUrl}`);

  const files = process.env.TEST_FILES
    ? process.env.TEST_FILES.split(/\s+/).filter(Boolean)
    : readdirSync(here)
        .filter((f) => /^t\d\d.*\.test\.mjs$/.test(f))
        .sort()
        .map((f) => path.join("tests", f));
  browserPlan = files.some((f) => /t33-csp-browser/.test(f)) ? "selected" : "not selected";
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
if (!scanLogsForLeaks()) code = 1;
const outcome = browserOutcome();
if (!outcome.ok) code = 1;
log(outcome.line);
log(code === 0 ? "ALL PASSED" : "FAILURES (see above)");
process.exit(code);
