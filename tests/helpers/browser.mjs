// The browser checks (t33) need Playwright and its Chromium. Neither is a
// dependency of this app, and nothing is ever installed or downloaded.
//
// The RUNNER decides once whether the browser checks run, by really starting
// the browser and closing it again (decideBrowserChecks). It tells the test
// processes what it decided and gives them what Playwright needs to find the
// same browser (browserEnvForTests). The TESTS never decide again: they read
// the decision (browserDecision), and when the runner said "run", a browser
// that cannot be started is a failure, never a skip (launchBrowser).
//
// TEST_BROWSER is read by the runner only:
//   "1"   the browser checks must run (the run fails if the browser cannot start)
//   "0"   skip the browser checks
//   unset run them when the browser starts, skip with a note when it does not

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * What Playwright reads from the environment to be found (NODE_PATH) and to
 * find its browser folder. HOME goes to every test process anyway.
 */
export const BROWSER_ENV_NAMES = ["NODE_PATH", "PLAYWRIGHT_BROWSERS_PATH", "XDG_CACHE_HOME", "LOCALAPPDATA"];

const firstLine = (err) => String(err?.message || err).split("\n")[0];

/** Start headless Chromium the default way (Playwright picks the browser it has). */
function start(playwright) {
  return playwright.chromium.launch({ headless: true, timeout: 30_000 });
}

/**
 * Runner side. Decides whether the browser checks run, by starting the
 * browser once and closing it again.
 * @returns {Promise<{ run: boolean, required: boolean, reason: string, modulePath?: string, version?: string }>}
 */
export async function decideBrowserChecks(mode = process.env.TEST_BROWSER) {
  const required = mode === "1";
  if (mode === "0") return { run: false, required, reason: "TEST_BROWSER=0" };
  let modulePath;
  try {
    modulePath = require.resolve("playwright");
  } catch {
    return { run: false, required, reason: "Playwright not found (set NODE_PATH to a folder that has it)" };
  }
  try {
    const browser = await start(require(modulePath));
    const version = browser.version();
    await browser.close();
    return { run: true, required, reason: `Chromium ${version} started`, modulePath, version };
  } catch (err) {
    return { run: false, required, reason: `Chromium did not start (the tests never download it): ${firstLine(err)}` };
  }
}

/**
 * Runner side. The environment entries that carry the decision to the test
 * processes, plus what Playwright needs there to find the same browser.
 */
export function browserEnvForTests(decision, env = process.env) {
  return {
    ...Object.fromEntries(BROWSER_ENV_NAMES.filter((name) => env[name]).map((name) => [name, env[name]])),
    TEST_BROWSER_CHECKS: decision.run ? "run" : "skip",
    TEST_BROWSER_REASON: decision.reason,
    ...(decision.run ? { TEST_PLAYWRIGHT_MODULE: decision.modulePath } : {}),
  };
}

/**
 * Test side. What the runner decided. Throws when there is no decision,
 * because then the test was not started by the runner (npm test).
 * @returns {{ run: boolean, reason: string }}
 */
export function browserDecision(env = process.env) {
  const said = env.TEST_BROWSER_CHECKS;
  if (said !== "run" && said !== "skip") {
    throw new Error("TEST_BROWSER_CHECKS is not set: run the tests with npm test, which decides whether the browser checks run");
  }
  return { run: said === "run", reason: env.TEST_BROWSER_REASON || "no reason given" };
}

/**
 * Test side. Starts the browser the runner started. Call it only when the
 * runner said "run". It throws when the browser cannot be started.
 */
export async function launchBrowser(env = process.env) {
  let playwright;
  try {
    playwright = require(env.TEST_PLAYWRIGHT_MODULE || "playwright");
  } catch (err) {
    throw new Error(`The runner said the browser checks run, but Playwright cannot be loaded in the test process: ${firstLine(err)}`);
  }
  try {
    return await start(playwright);
  } catch (err) {
    throw new Error(`The runner said the browser checks run, but Chromium did not start in the test process: ${firstLine(err)}`);
  }
}
