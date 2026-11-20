// Shared pieces of the layout check tool: where its files go, its local
// settings, a browser that can only reach the local app, and sign-in.
//
// Safety: nothing here reads DATABASE_URL or any other app setting from the
// outer environment. The settings come from one local file that setup.sh writes
// (tests/layout-check/out/settings.env), so a shell that happens to hold the
// live settings cannot point this tool at the live site or the live database.
// Only LAYOUT_CHECK_OUT and LAYOUT_CHECK_SETTINGS (two paths) are read from the
// environment.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TOOL_DIR, "..", "..");

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** The output folder: LAYOUT_CHECK_OUT, or tests/layout-check/out. */
export function outDir() {
  return path.resolve(process.env.LAYOUT_CHECK_OUT || path.join(TOOL_DIR, "out"));
}

/** A folder inside the output folder. It is created when missing. */
export function outPath(...parts) {
  const dir = path.join(outDir(), ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The local settings file: LAYOUT_CHECK_SETTINGS, or <output folder>/settings.env. */
export function settingsFile() {
  return path.resolve(process.env.LAYOUT_CHECK_SETTINGS || path.join(outDir(), "settings.env"));
}

/**
 * Reads NAME=value lines from the settings file (no quotes, no "export").
 * Lines that start with # are comments. Never prints a value.
 */
export function readSettings(file = settingsFile()) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `The settings file is missing: ${file}\nRun the one-time set-up first: bash tests/layout-check/setup.sh`
    );
  }
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** The settings, after checking that every name in `names` has a value. */
export function needSettings(names, settings = readSettings()) {
  const missing = names.filter((n) => !settings[n]);
  if (missing.length) {
    throw new Error(
      `The settings file ${settingsFile()} has no value for: ${missing.join(", ")}.\nSee tests/layout-check/settings.example.env, or run the set-up again.`
    );
  }
  return settings;
}

/**
 * Refuses a database that is not local or is not named for this tool
 * (the name must start with recrm_layout). Returns { host, port, database }.
 */
export function assertLayoutDatabase(connectionString) {
  // The driver turns query parameters into connection options (host, database),
  // which would get around the two checks below.
  if (typeof connectionString !== "string" || /[?#]/.test(connectionString)) {
    throw new Error("Refusing: DATABASE_URL in the settings file must not have a query string or a fragment");
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL in the settings file is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`Refusing: DATABASE_URL must be a postgres URL, got ${url.protocol}`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing: database host "${url.hostname}" is not local (allowed: 127.0.0.1, localhost, ::1)`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^recrm_layout[a-z0-9_]*$/.test(database)) {
    throw new Error(
      `Refusing: database "${database}" is not a layout check database (its name must start with recrm_layout)`
    );
  }
  return { host: url.hostname, port: url.port || "5432", database };
}

function isLoopback(address) {
  if (address === null || address === undefined) return true; // a local socket
  const a = String(address)
    .replace(/\/\d+$/, "")
    .toLowerCase();
  if (a === "::1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/**
 * Asks the connected server which database it is and where it listens, and
 * refuses unless the name starts with recrm_layout and the address is loopback
 * or a local socket. Call it after connecting and before any statement that
 * changes anything. Returns { database, address }.
 */
export async function assertConnectedToLayoutDatabase(sql) {
  const [row] = await sql`select current_database() as database, inet_server_addr()::text as address`;
  const database = row?.database;
  const address = row?.address ?? null;
  if (typeof database !== "string" || !/^recrm_layout[a-z0-9_]*$/.test(database)) {
    throw new Error(`Refusing: the connected database "${database}" is not a layout check database`);
  }
  if (!isLoopback(address)) {
    throw new Error(`Refusing: the connected server address ${address} is not loopback or a local socket`);
  }
  return { database, address };
}

/** The port of the local sign-in stub, from AUTH_STUB_PORT in the settings. */
export function stubPort(settings) {
  const port = Number(settings.AUTH_STUB_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("AUTH_STUB_PORT in the settings file must be a port number from 1024 to 65535");
  }
  return port;
}

/**
 * The address the app is built to use in place of Supabase. It is always the
 * local sign-in stub: the tool never takes a Supabase address from a setting.
 */
export function stubUrl(settings) {
  return `http://127.0.0.1:${stubPort(settings)}`;
}

/** A run label is part of file names, so only letters, digits, - and _ are allowed. */
export function assertLabel(label) {
  if (typeof label !== "string" || !/^[a-z0-9_-]+$/i.test(label)) {
    throw new Error(`A label may only have letters, digits, - and _ (got "${label}")`);
  }
  return label;
}

/**
 * Refuses an app address that is not plain http on 127.0.0.1 or localhost, so
 * the tool can never be pointed at the live site. Returns the address without
 * a path, for example http://127.0.0.1:3111.
 */
export function assertLocalUrl(value, what = "The app address") {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${what} is not a valid URL: ${value}`);
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`Refusing: ${what} must be an http address on 127.0.0.1 or localhost, got ${value}`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(`${what} must not have a path, for example http://127.0.0.1:3111 (got ${value})`);
  }
  return url.origin;
}

/**
 * Playwright, which is not a dependency of this app on purpose. It must be
 * available to Node some other way (in Claude cloud sessions it is installed
 * globally and found through NODE_PATH).
 */
export function loadPlaywright() {
  const load = createRequire(import.meta.url);
  try {
    return load("playwright");
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "Playwright was not found. It is not a dependency of this app on purpose. Install it outside the app " +
          "and make it visible to Node through NODE_PATH (see tests/layout-check/README.md, What it needs)."
      );
    }
    throw err;
  }
}

// The browser clock is fixed (Date only; timers keep running), so the calendar
// always opens on November 2026, the month the seeded events are in.
export const FIXED_TIME = "2026-11-20T12:00:00-05:00";

export const NOANIM_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;
transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}`;

/**
 * A browser context with the two safety rails:
 * - every request to a host other than 127.0.0.1 or localhost is blocked
 *   (reported through onBlockedHost);
 * - every call to the app that is not a GET (its /api/ routes and server
 *   actions) is blocked (reported through onBlockedWrite), so a run cannot
 *   change saved data. A script that needs to show what the app does after a
 *   save answers that one call itself with page.route() and says so in its report.
 */
export async function newSafeContext(
  browser,
  { width, height, appOrigin, onBlockedHost = () => {}, onBlockedWrite = () => {}, deviceScaleFactor = 2 }
) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
    timezoneId: "America/New_York",
    locale: "en-US",
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  await ctx.clock.setFixedTime(new Date(FIXED_TIME));
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return route.continue();
    }
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (!["127.0.0.1", "localhost"].includes(u.hostname)) {
      onBlockedHost(u.hostname);
      return route.abort("blockedbyclient");
    }
    const method = req.method();
    if (u.origin === appOrigin && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const isApi = u.pathname.startsWith("/api/");
      const isAction = !!req.headers()["next-action"];
      if (isApi || isAction) {
        onBlockedWrite({ method, path: u.pathname, kind: isApi ? "api" : "server action" });
        return route.abort("blockedbyclient");
      }
    }
    return route.continue();
  });
  return ctx;
}

/**
 * Signs in through the real login page.
 *
 * A script must not type before the page's own code has taken over the form:
 * when that code attaches, it resets the two fields, so values typed earlier
 * are wiped (seen on a busy machine: empty fields and no sign-in sent, or a
 * wrong value and "Invalid login credentials"). So this waits until the form
 * is live, types, checks that the values are still there, and only then
 * presses Sign In. Up to 3 tries.
 */
export async function signIn(page, { base, email, password, note = () => {} }) {
  const formLive = () => {
    const f = document.querySelector("form");
    return !!f && Object.keys(f).some((k) => k.startsWith("__reactProps"));
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    if (!new URL(page.url()).pathname.startsWith("/login")) return; // already signed in
    await page
      .waitForFunction(formLive, null, { timeout: 30000 })
      .catch(() => note("the login form never became live"));
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    const kept =
      (await page.locator("#email").inputValue()) === email &&
      (await page.locator("#password").inputValue()) === password;
    if (!kept) {
      note("the typed sign-in values were wiped; trying again");
      continue;
    }
    await page.locator("form button[type=submit]").click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      note("sign-in did not leave /login within 30 s; trying again");
    }
  }
  throw new Error(
    "Sign-in failed after 3 tries. Is the sign-in stub running (node tests/layout-check/serve.mjs stub-start)?"
  );
}

/** The first line of an error message, without the color codes that Playwright puts in. */
export function firstLine(err) {
  const colorCode = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
  return String(err && err.message ? err.message : err)
    .split("\n")[0]
    .replace(colorCode, "");
}

/**
 * Reads the command line. `values` are options that take a value (--port 3111),
 * `flags` are options without one (--no-build). Any other option is an error.
 * Returns { options, rest }.
 */
export function parseArgs(argv, { values = [], flags = [] } = {}) {
  const options = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const name = a.slice(2);
    if (values.includes(name)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) throw new Error(`Option --${name} needs a value`);
      options[name] = argv[++i];
    } else if (flags.includes(name)) {
      options[name] = true;
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return { options, rest };
}
