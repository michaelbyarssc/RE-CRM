// Finds Playwright and its Chromium for the browser checks, without
// installing anything. Playwright is not a dependency of this app: it is
// found through NODE_PATH (a global install), and its browser through
// PLAYWRIGHT_BROWSERS_PATH or Playwright's default folder.
//
// TEST_BROWSER decides what happens when they are missing:
//   "1"   the browser checks must run (missing Playwright or Chromium fails the run)
//   "0"   skip the browser checks
//   unset run them when found, skip with a note when not

import { createRequire } from "node:module";
import { existsSync } from "node:fs";

/**
 * @returns {{ run: boolean, required: boolean, reason: string, chromium?: any, executable?: string }}
 */
export function findBrowser(mode = process.env.TEST_BROWSER) {
  const required = mode === "1";
  if (mode === "0") return { run: false, required, reason: "TEST_BROWSER=0" };
  let playwright;
  try {
    playwright = createRequire(import.meta.url)("playwright");
  } catch {
    return { run: false, required, reason: "Playwright not found (set NODE_PATH to a folder that has it)" };
  }
  let executable;
  try {
    executable = playwright.chromium.executablePath();
  } catch (err) {
    return { run: false, required, reason: `Chromium not found: ${String(err.message || err).split("\n")[0]}` };
  }
  if (!executable || !existsSync(executable)) {
    return { run: false, required, reason: `Chromium not found at ${executable} (it is never downloaded by the tests)` };
  }
  return { run: true, required, reason: `Chromium at ${executable}`, chromium: playwright.chromium, executable };
}
