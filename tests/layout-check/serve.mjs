#!/usr/bin/env node
// Builds a checkout of the app, serves the production build on a local port,
// and stops it again. Also starts and stops the local sign-in stub.
//
//   node tests/layout-check/serve.mjs start --port 3111 [--dir <checkout>] [--no-build]
//   node tests/layout-check/serve.mjs stop --port 3111
//   node tests/layout-check/serve.mjs stub-start
//   node tests/layout-check/serve.mjs stub-stop
//   node tests/layout-check/serve.mjs status
//
// --dir is the checkout to build and serve (default: the checkout this file is
// in). It needs its own node_modules (npm ci). It does not need to contain
// this tool, so an older commit can be served as the "before".
//
// Safety:
// - The app gets an environment made here: the local database and the local
//   sign-in stub from the settings file, and nothing from the shell except
//   PATH and HOME. No live setting can leak in.
// - A checkout that holds a .env file is refused, because Next.js would load it.
// - The server is started with the test suite's network guard
//   (tests/helpers/no-network.cjs), so the app itself cannot call a host that
//   is not local. What it tried is written to out/logs/network-<port>.jsonl.
// - Logs and the records of what is running are in out/logs/.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  REPO_ROOT,
  TOOL_DIR,
  assertLayoutDatabase,
  needSettings,
  outDir,
  outPath,
  parseArgs,
  settingsFile,
  stubPort,
  stubUrl,
} from "./lib.mjs";

const NETWORK_GUARD = path.join(REPO_ROOT, "tests", "helpers", "no-network.cjs");
// Not a credential: the stub ignores it. The app only needs some value.
const ANON_KEY = "layout-check-anon-key";

const logsDir = () => outPath("logs");
const recordFile = (name) => path.join(logsDir(), `${name}.json`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readRecord(name) {
  try {
    return JSON.parse(fs.readFileSync(recordFile(name), "utf8"));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Is this still the process the record is about? A process id can be given to
// another program after a restart, so on Linux the working folder is compared.
function isOurs(record) {
  if (!record || !alive(record.pid)) return false;
  try {
    return fs.realpathSync(`/proc/${record.pid}/cwd`) === fs.realpathSync(record.cwd);
  } catch {
    return true; // no /proc on this system: trust the record
  }
}

function portBusy(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, "127.0.0.1");
  });
}

function portOf(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Give a port with --port, a number from 1024 to 65535 (for example --port 3111)");
  }
  return port;
}

// What a child process may see of the shell: nothing but these.
function baseEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
    // The dashboard's "upcoming" list uses the server clock. A fixed time zone
    // keeps the day boundary the same on every machine.
    TZ: "UTC",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

function appEnv(settings, port) {
  return {
    ...baseEnv(),
    DATABASE_URL: settings.DATABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: stubUrl(settings),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
  };
}

async function stopGroup(record, what) {
  if (!isOurs(record)) return false;
  // The server was started as the leader of its own process group, so this
  // also stops any child it made.
  try {
    process.kill(-record.pid, "SIGTERM");
  } catch {
    // already gone
  }
  for (let i = 0; i < 50 && alive(record.pid); i++) await sleep(200);
  if (alive(record.pid)) {
    try {
      process.kill(-record.pid, "SIGKILL");
    } catch {
      // already gone
    }
    await sleep(300);
  }
  console.log(`Stopped ${what} (process ${record.pid}).`);
  return true;
}

// ---------------------------------------------------------------- sign-in stub

async function stubState(settings) {
  const port = stubPort(settings);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/layout-check/health`, { signal: AbortSignal.timeout(2000) });
    const body = await res.json();
    if (body && body.stub === "layout-check" && body.userId === settings.DEMO_USER_ID) return "ours";
    return "other";
  } catch {
    return (await portBusy(port)) ? "other" : "down";
  }
}

async function stubStart() {
  const settings = needSettings(["AUTH_STUB_PORT", "DEMO_USER_ID", "DEMO_USER_EMAIL", "DEMO_USER_PASSWORD"]);
  const port = stubPort(settings);
  const state = await stubState(settings);
  if (state === "ours") {
    console.log(`The sign-in stub is already running on http://127.0.0.1:${port}.`);
    return;
  }
  if (state === "other") {
    throw new Error(
      `Port ${port} is in use by another program, or by a sign-in stub with other settings. ` +
        `Stop it, or set another AUTH_STUB_PORT in ${settingsFile()} and build the app again.`
    );
  }
  const logFile = path.join(logsDir(), "auth-stub.log");
  const log = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [path.join(TOOL_DIR, "auth-stub.mjs")], {
    cwd: TOOL_DIR,
    env: { ...baseEnv(), LAYOUT_CHECK_OUT: outDir(), LAYOUT_CHECK_SETTINGS: settingsFile() },
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  fs.closeSync(log);
  fs.writeFileSync(
    recordFile("auth-stub"),
    JSON.stringify({ pid: child.pid, port, cwd: TOOL_DIR, started: new Date().toISOString(), log: logFile }, null, 2)
  );
  for (let i = 0; i < 50; i++) {
    if ((await stubState(settings)) === "ours") {
      console.log(`Started the sign-in stub on http://127.0.0.1:${port} (log: ${logFile}).`);
      return;
    }
    await sleep(200);
  }
  throw new Error(`The sign-in stub did not start. See ${logFile}`);
}

async function stubStop() {
  const record = readRecord("auth-stub");
  if (await stopGroup(record, "the sign-in stub")) {
    fs.rmSync(recordFile("auth-stub"), { force: true });
    return;
  }
  fs.rmSync(recordFile("auth-stub"), { force: true });
  console.log("No sign-in stub started by this tool is running.");
}

// ---------------------------------------------------------------- app server

function appRecords() {
  return fs
    .readdirSync(logsDir())
    .filter((f) => /^app-\d+\.json$/.test(f))
    .map((f) => readRecord(f.replace(/\.json$/, "")))
    .filter(Boolean);
}

function gitInfo(dir) {
  const run = (args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  const head = run(["rev-parse", "--short", "HEAD"]);
  if (head.status !== 0) return { commit: "unknown", changed: null };
  const status = run(["status", "--porcelain"]);
  return { commit: head.stdout.trim(), changed: status.status === 0 ? status.stdout.trim() !== "" : null };
}

async function start(options) {
  const port = portOf(options.port);
  const dir = fs.realpathSync(path.resolve(options.dir || REPO_ROOT));
  const settings = needSettings([
    "DATABASE_URL",
    "AUTH_STUB_PORT",
    "SETTINGS_ENCRYPTION_KEY",
    "DEMO_USER_ID",
    "DEMO_USER_EMAIL",
    "DEMO_USER_PASSWORD",
  ]);
  const db = assertLayoutDatabase(settings.DATABASE_URL);
  const nextBin = path.join(dir, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(path.join(dir, "package.json")) || !fs.existsSync(nextBin)) {
    throw new Error(`${dir} is not a checkout of the app with its packages installed. Run "npm ci" there first.`);
  }
  // Next.js loads .env files from the project folder on its own. Refuse if any
  // exist, so the app can only see the environment made here.
  const envFiles = fs.readdirSync(dir).filter((f) => f.startsWith(".env") && f !== ".env.example");
  if (envFiles.length) {
    throw new Error(`Refusing: found ${envFiles.join(", ")} in ${dir}. It may hold live settings. Move it away first.`);
  }
  if (!fs.existsSync(NETWORK_GUARD)) {
    throw new Error(`The network guard ${NETWORK_GUARD} is missing, so the server is not started.`);
  }
  for (const record of appRecords()) {
    if (!isOurs(record)) continue;
    if (record.port === port) {
      throw new Error(
        `A server of this tool is already running on port ${port}. Stop it first: serve.mjs stop --port ${port}`
      );
    }
    if (record.cwd === dir && !options["no-build"]) {
      throw new Error(
        `The server on port ${record.port} serves from ${dir}. A new build would replace the files it is serving. ` +
          `Stop it first (serve.mjs stop --port ${record.port}), or start this one with --no-build.`
      );
    }
  }
  if (await portBusy(port)) throw new Error(`Refusing: port ${port} is in use. Choose another port.`);

  await stubStart();

  const env = appEnv(settings, port);
  const git = gitInfo(dir);
  const describe = `${dir} at ${git.commit}${git.changed ? " with uncommitted changes" : ""}`;
  if (options["no-build"]) {
    if (!fs.existsSync(path.join(dir, ".next", "BUILD_ID"))) {
      throw new Error(`There is no build in ${dir}. Run again without --no-build.`);
    }
    console.log(`Reusing the last build of ${describe}.`);
  } else {
    const buildLog = path.join(logsDir(), `build-${port}.log`);
    console.log(`Building ${describe} (log: ${buildLog}). This takes up to a minute.`);
    const log = fs.openSync(buildLog, "w");
    // Like the test runner: no encryption key at build time.
    const built = spawnSync(process.execPath, [nextBin, "build"], { cwd: dir, env, stdio: ["ignore", log, log] });
    fs.closeSync(log);
    if (built.status !== 0) {
      const tail = fs.readFileSync(buildLog, "utf8").split("\n").slice(-25).join("\n");
      throw new Error(`The build failed. The end of ${buildLog}:\n${tail}`);
    }
  }

  const appLog = path.join(logsDir(), `app-${port}.log`);
  const networkLog = path.join(logsDir(), `network-${port}.jsonl`);
  fs.writeFileSync(networkLog, "");
  const log = fs.openSync(appLog, "w");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: dir,
    env: {
      ...env,
      SETTINGS_ENCRYPTION_KEY: settings.SETTINGS_ENCRYPTION_KEY,
      NODE_OPTIONS: `--require "${NETWORK_GUARD}"`,
      TEST_NETWORK_LOG: networkLog,
    },
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  fs.closeSync(log);
  const record = {
    pid: child.pid,
    port,
    cwd: dir,
    commit: git.commit,
    uncommittedChanges: git.changed,
    database: db.database,
    started: new Date().toISOString(),
    log: appLog,
  };
  fs.writeFileSync(recordFile(`app-${port}`), JSON.stringify(record, null, 2));

  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (!alive(child.pid)) break;
    try {
      const res = await fetch(`${url}/login`, { signal: AbortSignal.timeout(3000) });
      await res.text();
      if (res.status === 200) {
        console.log(`Serving ${describe} on ${url} (database ${db.database}, log: ${appLog}).`);
        console.log(`Stop it with: node tests/layout-check/serve.mjs stop --port ${port}`);
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  await stopGroup(record, `the server on port ${port}`);
  fs.rmSync(recordFile(`app-${port}`), { force: true });
  const tail = fs.readFileSync(appLog, "utf8").split("\n").slice(-25).join("\n");
  throw new Error(`The server did not start. The end of ${appLog}:\n${tail}`);
}

async function stop(options) {
  const port = portOf(options.port);
  const record = readRecord(`app-${port}`);
  const stopped = await stopGroup(record, `the server on port ${port}`);
  fs.rmSync(recordFile(`app-${port}`), { force: true });
  if (stopped) return;
  if (await portBusy(port)) {
    throw new Error(
      `Port ${port} is in use, but not by a server this tool started (no record in ${logsDir()}). It was left alone.`
    );
  }
  console.log(`No server of this tool is running on port ${port}.`);
}

async function status() {
  console.log(`Output folder: ${outDir()}`);
  console.log(`Settings file: ${settingsFile()}${fs.existsSync(settingsFile()) ? "" : " (missing: run setup.sh)"}`);
  const stub = readRecord("auth-stub");
  console.log(
    isOurs(stub) ? `Sign-in stub: running on port ${stub.port} (process ${stub.pid})` : "Sign-in stub: not running"
  );
  const apps = appRecords().filter(isOurs);
  if (!apps.length) console.log("App servers: none running");
  for (const a of apps) {
    console.log(
      `App server: port ${a.port}, ${a.cwd} at ${a.commit}${a.uncommittedChanges ? " with uncommitted changes" : ""}, ` +
        `database ${a.database}, started ${a.started} (process ${a.pid})`
    );
  }
}

const USAGE = `Usage:
  node tests/layout-check/serve.mjs start --port <port> [--dir <checkout>] [--no-build]
  node tests/layout-check/serve.mjs stop --port <port>
  node tests/layout-check/serve.mjs stub-start
  node tests/layout-check/serve.mjs stub-stop
  node tests/layout-check/serve.mjs status`;

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2), { values: ["port", "dir"], flags: ["no-build"] });
  const commands = { start, stop, "stub-start": stubStart, "stub-stop": stubStop, status };
  const command = commands[rest[0]];
  if (!command || rest.length !== 1) {
    console.error(USAGE);
    return 1;
  }
  await command(options);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);
