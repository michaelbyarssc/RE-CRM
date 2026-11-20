// T33. In a real browser (Chromium through Playwright), the enforcing page
// policy (CSP) blocks injected script, every screen works with no policy
// violation, sign-in and sign-out reach the sign-in service, and the app
// cannot be put in a frame.
//
// The runner decides whether these checks run, by starting the browser once
// (helpers/browser.mjs, TEST_BROWSER in run.mjs). This file never decides
// again. When the runner said "skip", every check is skipped with the
// runner's reason. When it said "run" and the browser does not start here,
// every check FAILS. At the end the file reports to the runner what it
// really did, and the runner's closing line is made from that report.
//
// Violations are collected by a listener installed before any page script
// runs (securitypolicyviolation events). Each event is sent to the test at
// once, so nothing is lost when the page is left. Each injection check has a
// control: the same injection with the policy header removed, which must run,
// so the check is known to be able to see a script run.
//
// Outside requests never leave the machine: map tiles get a small local
// image, the "outside" script address is answered by the test, and every
// other outside request is aborted.
//
// A page error (an error that no code caught) on any screen fails the
// checks, with one narrow, named exception (see KNOWN_418_SCREENS). Other
// console errors do not fail them: the two expected kinds are named below,
// and anything else is printed in the test output.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { browserDecision, launchBrowser } from "./helpers/browser.mjs";
import { BROWSER_PASSWORD } from "./helpers/auth-stub.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import { sessionCookie } from "./helpers/http.mjs";
import { pageAddresses, PUBLIC_PAGES } from "./helpers/pages.mjs";

const decision = browserDecision();
const skip = decision.run ? false : `browser checks skipped by the runner: ${decision.reason}`;
if (skip) console.log(`# T33 ${skip}`);

const APP = process.env.TEST_APP_URL;
const AUTH = process.env.TEST_AUTH_URL;
const OUTSIDE_ORIGIN = "https://outside.example.com";
const OUTSIDE_SCRIPT = `${OUTSIDE_ORIGIN}/t33-probe.js`;
const FRAME_HOST = "http://frame-host.example.com/";
const UNKNOWN_PAGE = "/no-such-page-t33";
const POLICY_TEXT = /Content Security Policy|Content-Security-Policy|\bCSP\b/i;

// Page errors fail the checks, with ONE narrow exception: React error 418 on
// exactly these five screens. The cause is a button inside a button in the
// header of each of them. The fix is in pull request 4. DELETE this
// exception (this list and isKnown418) once that fix is on main: after
// that, no page error at all is allowed. A 418 on any other screen, and any
// other page error anywhere, already fails the checks.
const KNOWN_418_SCREENS = ["/leads", "/pipeline", "/buyers", "/calendar", "/sequences"];
const isKnown418 = (e) => /Minified React error #418\b/.test(e.text) && KNOWN_418_SCREENS.includes(e.path);

// Console errors that are not page errors do not fail the checks. Two kinds
// existed before this work and are expected:
// 1. The browser's own line for a page that answers 404: the unknown address.
// 2. After sign-out, calls that links had queued to fetch pages ahead of
//    time are sent on to /login and answer 404 (addresses "/login?_rsc=...").
// Every other console error is printed in the test output.
const RESOURCE_404 = "Failed to load resource: the server responded with a status of 404 (Not Found)";
const isExpectedConsoleError = (c) =>
  c.text === RESOURCE_404 && (c.url === APP + UNKNOWN_PAGE || c.url.startsWith(APP + "/login?_rsc="));
// A 1x1 PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let browser;
let ids;
// Set when the runner said "run" but the browser did not start here.
let startError = null;
// What this file really did, for the runner's closing line.
const report = { browserStarted: false, version: null, checksPlanned: 0, checksStarted: 0 };

/** One browser check. Skipped only when the runner said so; it fails when the browser did not start. */
function check(name, fn) {
  report.checksPlanned++;
  test(name, { skip }, async (t) => {
    if (startError) throw startError;
    report.checksStarted++;
    await fn(t);
  });
}

before(async () => {
  if (skip) return;
  try {
    browser = await launchBrowser();
  } catch (err) {
    startError = err;
    return;
  }
  report.browserStarted = true;
  report.version = browser.version();
  ids = await reseed();
  // A buyer zone, so the map draws one (the API would call the geocoder).
  const criteria = {
    areas: "Alphaville",
    geocodedAreas: [{ name: "Alphaville", lat: 34.9, lng: -81.9, type: "city" }],
  };
  await db()`UPDATE buyers SET buy_criteria = ${JSON.stringify(criteria)} WHERE id = ${ids.aBuyer}`;
});

after(async () => {
  if (!skip && process.env.TEST_BROWSER_RESULT_FILE) {
    writeFileSync(process.env.TEST_BROWSER_RESULT_FILE, JSON.stringify(report));
  }
  if (browser) await browser.close();
  await closeDb();
});

// Installed before any page script runs.
function violationListener() {
  document.addEventListener(
    "securitypolicyviolation",
    (e) => {
      try {
        window.__t33Report({
          directive: e.effectiveDirective,
          blocked: e.blockedURI,
          disposition: e.disposition,
          document: e.documentURI,
        });
      } catch {
        // never break the page
      }
    },
    true
  );
}

/** The path of the page an event came from. */
function pathOf(page) {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return "?";
  }
}

/** A fresh context that records violations, console errors, policy console lines and page errors. */
async function newContext({ signedIn = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const seen = { violations: [], policyConsole: [], consoleErrors: [], pageErrors: [], outsideAborted: [] };
  await context.exposeBinding("__t33Report", (_source, v) => seen.violations.push(v));
  await context.addInitScript(violationListener);
  context.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (POLICY_TEXT.test(m.text())) seen.policyConsole.push(m.text());
    else if (m.type() === "error") seen.consoleErrors.push({ text: m.text(), url: m.location()?.url || "", path: pathOf(m.page()) });
  });
  context.on("weberror", (e) =>
    seen.pageErrors.push({ text: String(e.error()?.message || e.error()).split("\n")[0], path: pathOf(e.page()) })
  );
  // Requests to anything but the app and the sign-in stub stay on this machine.
  await context.route(
    (url) => !url.href.startsWith(APP) && !url.href.startsWith(AUTH),
    (route) => {
      const url = route.request().url();
      if (/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url)) {
        return route.fulfill({ status: 200, contentType: "image/png", body: TILE });
      }
      seen.outsideAborted.push(url);
      return route.abort();
    }
  );
  if (signedIn) {
    const [name, ...rest] = sessionCookie(USERS.A).split("=");
    await context.addCookies([{ name, value: rest.join("="), url: APP }]);
  }
  return { context, seen };
}

/** Page errors since index `from` that are not the known React error 418, as readable text. */
function pageErrorProblems(seen, from = 0) {
  return seen.pageErrors
    .slice(from)
    .filter((e) => !isKnown418(e))
    .map((e) => `page error on ${e.path}: ${e.text}`);
}

/** What fails a screen check since `mark`: violations, policy console lines and page errors. */
function newProblems(seen, mark) {
  return [
    ...seen.violations.slice(mark.v).map((v) => `violation ${v.directive} blocked=${v.blocked} on ${v.document}`),
    ...seen.policyConsole.slice(mark.c).map((t) => `console: ${t}`),
    ...pageErrorProblems(seen, mark.p),
  ];
}
const markOf = (seen) => ({ v: seen.violations.length, c: seen.policyConsole.length, p: seen.pageErrors.length });

/**
 * Print the page error count and every console error that is not one of the
 * two expected kinds. `visitedKnownScreens`: this check opened the five
 * screens of the 418 exception.
 */
function printNotes(t, seen, { visitedKnownScreens = false } = {}) {
  const known = seen.pageErrors.filter(isKnown418);
  const where = [...new Set(known.map((e) => e.path))].join(", ") || "none";
  t.diagnostic(`page errors: ${seen.pageErrors.length}, of them the known React error 418: ${known.length} (on ${where})`);
  if (visitedKnownScreens && known.length === 0) {
    t.diagnostic("the known React error 418 did not show up: if the fix is on main now, delete the exception in this file");
  }
  const expected = seen.consoleErrors.filter(isExpectedConsoleError);
  t.diagnostic(`console errors: ${seen.consoleErrors.length}, of them expected 404 lines: ${expected.length}`);
  for (const c of seen.consoleErrors.filter((c) => !isExpectedConsoleError(c))) {
    t.diagnostic(`unexpected console error on ${c.path}: ${c.text} (${c.url})`);
  }
}

/** Wait until check() is true. Returns false when it is still not true after ms. */
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

// ---------- a, b, e: sign in, every screen, sign out (one signed-in context) ----------

check("T33 sign-in, every screen and sign-out raise no policy violation and no page error", async (t) => {
  const { context, seen } = await newContext();
  const page = await context.newPage();
  try {
    await t.test("a. sign in through the real login form, land on the dashboard", async () => {
      const mark = markOf(seen);
      await page.goto(APP + "/login", { waitUntil: "load" });
      // Fill the form only once React has attached to it. Before that, a
      // click on the button would be a plain form submit by the browser.
      const formIsLive = () =>
        page.evaluate(() => {
          const form = document.querySelector("form");
          return Boolean(form) && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
        });
      assert.ok(
        await until(formIsLive, 15_000),
        "the login form did not become interactive within 15 seconds (React did not attach to it), so it was not filled"
      );
      await page.locator("#email").fill(USERS.A.email);
      await page.locator("#password").fill(BROWSER_PASSWORD);
      const token = page.waitForResponse(
        (r) => r.url().startsWith(AUTH + "/auth/v1/token") && r.request().method() === "POST",
        { timeout: 15_000 }
      );
      await page.getByRole("button", { name: /Sign In/ }).click();
      assert.equal((await token).status(), 200, "the sign-in service did not accept the sign-in");
      await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 20_000 });
      await settle(page);
      // The sidebar asks the sign-in service who is signed in and shows the email.
      const emailShown = () => page.locator("body").innerText().then((text) => text.includes(USERS.A.email));
      assert.ok(await until(emailShown, 10_000), "the sidebar does not show the signed-in email");
      assert.deepEqual(newProblems(seen, mark), []);
    });

    await t.test("b. every page route signed in", async () => {
      // Every page route of the build (helpers/pages.mjs fails when a page
      // is not listed there), then the unknown address. Signed in, /login
      // goes on to the dashboard.
      const paths = [...pageAddresses(ids).map((p) => p.path), UNKNOWN_PAGE];
      const problems = [];
      for (const path of paths) {
        const mark = markOf(seen);
        const res = await page.goto(APP + path, { waitUntil: "load" });
        const expected = path === UNKNOWN_PAGE ? 404 : 200;
        assert.equal(res.status(), expected, `${path}: ${res.status()}`);
        assert.equal(new URL(page.url()).pathname, path === "/login" ? "/" : path, `${path}: landed on ${page.url()}`);
        assert.ok(res.headers()["content-security-policy"], `${path}: no policy header`);
        await settle(page);
        if (path === "/map") {
          await page.locator(".leaflet-marker-icon").first().waitFor({ state: "visible", timeout: 10_000 });
          await page.locator(".leaflet-marker-icon").first().click({ force: true });
          await page.locator(".leaflet-popup").first().waitFor({ state: "visible", timeout: 5000 });
          await page.getByRole("button", { name: /Buyer Zones/ }).first().click();
          await page.locator("path.leaflet-interactive").first().waitFor({ state: "attached", timeout: 5000 });
          await settle(page);
        }
        if (path === "/calendar") {
          await page.locator(".fc-daygrid, .fc-timegrid").first().waitFor({ state: "visible", timeout: 10_000 });
        }
        await page.waitForTimeout(200);
        problems.push(...newProblems(seen, mark).map((p) => `${path}: ${p}`));
      }
      assert.deepEqual(problems, []);
    });

    await t.test("e. sign out through the sidebar ends on /login", async () => {
      await page.goto(APP + "/", { waitUntil: "load" });
      await settle(page);
      const mark = markOf(seen);
      const logout = page.waitForResponse(
        (r) => r.url().startsWith(AUTH + "/auth/v1/logout") && r.request().method() === "POST",
        { timeout: 15_000 }
      );
      await page.locator('button:has-text("Sign Out"):visible').first().click();
      assert.equal((await logout).status(), 204, "the sign-in service did not accept the sign-out");
      await page.waitForURL((u) => new URL(u).pathname === "/login", { timeout: 15_000 });
      await settle(page);
      // The session is gone: the dashboard sends the browser back to /login.
      await page.goto(APP + "/", { waitUntil: "load" });
      assert.equal(new URL(page.url()).pathname, "/login");
      assert.deepEqual(newProblems(seen, mark), []);
    });

    // Page errors that arrived late, after the last step above.
    await page.waitForTimeout(300);
    assert.deepEqual(pageErrorProblems(seen), []);
    printNotes(t, seen, { visitedKnownScreens: true });
  } finally {
    await context.close();
  }
});

check("T33 b. signed-out pages and the signed-out 404 redirect raise no policy violation and no page error", async (t) => {
  const { context, seen } = await newContext();
  const page = await context.newPage();
  try {
    const problems = [];
    for (const path of [...PUBLIC_PAGES, UNKNOWN_PAGE]) {
      const mark = markOf(seen);
      await page.goto(APP + path, { waitUntil: "load" });
      await settle(page);
      const landed = new URL(page.url()).pathname;
      assert.equal(landed, path === UNKNOWN_PAGE ? "/login" : path);
      await page.waitForTimeout(200);
      problems.push(...newProblems(seen, mark).map((p) => `${path}: ${p}`));
    }
    assert.deepEqual(problems, []);
    printNotes(t, seen);
  } finally {
    await context.close();
  }
});

// ---------- c: injected script does not run ----------

/**
 * Open `path` with `extra` HTML added before </body> on its way to the
 * browser. keepPolicy=false removes the policy header (the control).
 */
async function openInjected(page, path, extra, keepPolicy) {
  let injected = false;
  await page.route(APP + path, async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    // No redirects here: a bounce to /login must not pass as the page under test.
    const res = await route.fetch({ maxRedirects: 0 });
    const html = await res.text();
    injected = html.includes("</body>");
    const headers = { ...res.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    if (!keepPolicy) delete headers["content-security-policy"];
    return route.fulfill({ status: res.status(), headers, body: html.replace("</body>", `${extra}</body>`) });
  });
  const res = await page.goto(APP + path, { waitUntil: "load" });
  assert.equal(res.status(), 200);
  assert.ok(injected, "the page has no </body> to inject before");
  assert.equal(Boolean(res.headers()["content-security-policy"]), keepPolicy, "policy header on the injected page");
  return res;
}

function probe(page, name) {
  return page.evaluate((n) => window[n] ?? null, name);
}

/** True once a script violation was recorded after `from` whose blocked address passes `isBlocked`. */
function scriptViolation(seen, from, isBlocked) {
  return until(() => seen.violations.slice(from).some((v) => /^script-src/.test(v.directive) && isBlocked(v.blocked)), 3000);
}

// `shows` is text that only this page renders, so each check is known to run
// on the page it names. (The dashboard is served only to a signed-in
// request. The sidebar's "Sign Out" cannot be the marker: Chromium refuses
// calls to the local sign-in stub from a page the test has rewritten.)
for (const where of [
  { label: "/login signed out", path: "/login", signedIn: false, shows: "Sign in to your account" },
  { label: "the dashboard signed in", path: "/", signedIn: true, shows: "Quick Actions" },
]) {
  check(`T33 c. injected script does not run on ${where.label}, and runs without the policy (control)`, async (t) => {
    // Each case runs twice, each time in a fresh context: with the policy
    // (the script must not run and a violation must be recorded), then
    // without it (the control: the script must run).
    async function both(run) {
      for (const keepPolicy of [true, false]) {
        const { context, seen } = await newContext({ signedIn: where.signedIn });
        const page = await context.newPage();
        await page.route(OUTSIDE_SCRIPT, (route) =>
          route.fulfill({ status: 200, contentType: "text/javascript", body: "window.__probeOutside = 'ran';" })
        );
        try {
          await run(page, seen, keepPolicy);
          const onPage = () => page.locator("body").innerText().then((text) => text.includes(where.shows));
          assert.ok(await until(onPage, 10_000), `this is not ${where.label}: "${where.shows}" is not shown`);
          assert.deepEqual(pageErrorProblems(seen), []);
        } finally {
          await context.close();
        }
      }
    }

    await t.test("inline script added to the HTML", async () => {
      await both(async (page, seen, keepPolicy) => {
        await openInjected(page, where.path, `<script>window.__probeInline = 'ran'</script>`, keepPolicy);
        if (keepPolicy) {
          assert.equal(await probe(page, "__probeInline"), null, "the injected inline script ran");
          assert.ok(await scriptViolation(seen, 0, (b) => b === "inline"), `no violation: ${JSON.stringify(seen.violations)}`);
        } else {
          assert.equal(await probe(page, "__probeInline"), "ran", "control: the script did not run without the policy");
        }
      });
    });

    await t.test("script tag from another origin, without a nonce, added to the HTML", async () => {
      await both(async (page, seen, keepPolicy) => {
        await openInjected(page, where.path, `<script src="${OUTSIDE_SCRIPT}"></script>`, keepPolicy);
        if (keepPolicy) {
          assert.equal(await probe(page, "__probeOutside"), null, "the outside script ran");
          assert.ok(
            await scriptViolation(seen, 0, (b) => b.startsWith(OUTSIDE_ORIGIN)),
            `no violation naming the outside address: ${JSON.stringify(seen.violations)}`
          );
        } else {
          assert.equal(await probe(page, "__probeOutside"), "ran", "control: the outside script did not run without the policy");
        }
      });
    });

    await t.test("inline event handler inserted with innerHTML after load", async () => {
      await both(async (page, seen, keepPolicy) => {
        await openInjected(page, where.path, "", keepPolicy);
        const from = seen.violations.length;
        // Resolves once the picture has failed to load, which is when the
        // inline handler would run. (A listener added by script is allowed.)
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const div = document.createElement("div");
              div.innerHTML = `<img src="/_next/static/t33-no-such-image.png" onerror="window.__probeHandler = 'ran'">`;
              div.querySelector("img").addEventListener("error", () => setTimeout(resolve, 50));
              document.body.appendChild(div);
            })
        );
        if (keepPolicy) {
          assert.equal(await probe(page, "__probeHandler"), null, "the injected handler ran");
          assert.ok(await scriptViolation(seen, from, (b) => b === "inline"), `no violation: ${JSON.stringify(seen.violations)}`);
        } else {
          assert.equal(await probe(page, "__probeHandler"), "ran", "control: the handler did not run without the policy");
        }
      });
    });

    await t.test("inline script element created with createElement", async () => {
      await both(async (page, seen, keepPolicy) => {
        await openInjected(page, where.path, "", keepPolicy);
        const from = seen.violations.length;
        await page.evaluate(() => {
          const s = document.createElement("script");
          s.textContent = "window.__probeElement = 'ran'";
          document.body.appendChild(s);
        });
        if (keepPolicy) {
          assert.equal(await probe(page, "__probeElement"), null, "the created script ran");
          assert.ok(await scriptViolation(seen, from, (b) => b === "inline"), `no violation: ${JSON.stringify(seen.violations)}`);
        } else {
          assert.equal(await probe(page, "__probeElement"), "ran", "control: the script did not run without the policy");
        }
      });
    });

    await t.test("script element created with createElement that points at another origin", async () => {
      await both(async (page, seen, keepPolicy) => {
        await openInjected(page, where.path, "", keepPolicy);
        const from = seen.violations.length;
        // Resolves with "load" when the script was fetched and run, "error" when it was refused.
        const outcome = await page.evaluate(
          (src) =>
            new Promise((resolve) => {
              const s = document.createElement("script");
              s.src = src;
              s.addEventListener("load", () => resolve("load"));
              s.addEventListener("error", () => resolve("error"));
              document.body.appendChild(s);
            }),
          OUTSIDE_SCRIPT
        );
        if (keepPolicy) {
          assert.equal(outcome, "error", "the created outside script was loaded");
          assert.equal(await probe(page, "__probeOutside"), null, "the created outside script ran");
          assert.ok(
            await scriptViolation(seen, from, (b) => b.startsWith(OUTSIDE_ORIGIN)),
            `no violation naming the outside address: ${JSON.stringify(seen.violations)}`
          );
        } else {
          assert.equal(outcome, "load", "control: the outside script was not loaded without the policy");
          assert.equal(await probe(page, "__probeOutside"), "ran", "control: the outside script did not run without the policy");
        }
      });
    });

    await t.test("text turned into code with eval", async () => {
      await both(async (page, seen, keepPolicy) => {
        await openInjected(page, where.path, "", keepPolicy);
        const from = seen.violations.length;
        // The eval call runs in a page timer, like any script of the page would.
        const outcome = await page.evaluate(
          () =>
            new Promise((resolve) =>
              setTimeout(() => {
                try {
                  resolve(String((0, eval)("40 + 2")));
                } catch (err) {
                  resolve(err.name);
                }
              }, 0)
            )
        );
        if (keepPolicy) {
          assert.equal(outcome, "EvalError", "eval ran");
          assert.ok(await scriptViolation(seen, from, (b) => b === "eval"), `no violation: ${JSON.stringify(seen.violations)}`);
        } else {
          assert.equal(outcome, "42", "control: eval did not run without the policy");
        }
      });
    });
  });
}

// ---------- d: the app cannot be put in a frame ----------

check("T33 d. another site cannot show the app in a frame", async (t) => {
  // Two headers each forbid framing on their own: the policy's
  // frame-ancestors 'none' and X-Frame-Options. The frame shows the app only
  // when BOTH are removed (the control).
  const cases = [
    { name: "both headers present", drop: [], shows: false },
    { name: "X-Frame-Options removed: the policy alone still forbids it", drop: ["x-frame-options"], shows: false },
    { name: "the policy removed: X-Frame-Options alone still forbids it", drop: ["content-security-policy"], shows: false },
    { name: "control, both removed: the frame shows the app", drop: ["x-frame-options", "content-security-policy"], shows: true },
  ];
  for (const c of cases) {
    await t.test(c.name, async () => {
      const { context, seen } = await newContext();
      const page = await context.newPage();
      try {
        await page.route(FRAME_HOST, (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: `<!doctype html><title>frame host</title><iframe src="${APP}/login" width="800" height="600"></iframe>`,
          })
        );
        let sent = null; // the two headers as the app sent them
        await page.route(APP + "/login", async (route) => {
          const res = await route.fetch();
          const headers = { ...res.headers() };
          sent = { xfo: headers["x-frame-options"], policy: headers["content-security-policy"] || "" };
          for (const h of [...c.drop, "content-length", "content-encoding"]) delete headers[h];
          return route.fulfill({ status: res.status(), headers, body: await res.text() });
        });
        await page.goto(FRAME_HOST, { waitUntil: "load" });
        assert.equal(sent?.xfo, "DENY");
        assert.match(sent.policy, /frame-ancestors 'none'/);
        const showsApp = () => {
          const frame = page.frames().find((f) => f !== page.mainFrame());
          if (!frame || !frame.url().startsWith(APP)) return false;
          return frame
            .evaluate(() => (document.body?.innerText || "").includes("Deal Desk Pro"))
            .catch(() => false);
        };
        if (c.shows) {
          assert.ok(await until(showsApp, 10_000), "control: the frame did not show the app without the headers");
        } else {
          await page.waitForTimeout(700);
          assert.equal(await showsApp(), false, "the frame shows the app");
        }
        assert.deepEqual(pageErrorProblems(seen), []);
      } finally {
        await context.close();
      }
    });
  }
});
