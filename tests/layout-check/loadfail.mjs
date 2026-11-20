#!/usr/bin/env node
// Shows what the leads screen and the buyers screen look like when their list
// cannot be loaded, and measures the message.
//
//   node tests/layout-check/loadfail.mjs <app address> <label>
//   node tests/layout-check/loadfail.mjs http://127.0.0.1:3111 after
//
// The list request (GET /api/leads, GET /api/buyers) is answered inside the
// browser with status 500, so the app shows its own "could not be loaded"
// message. That request never reaches the app, and nothing is saved. On the
// leads screen the script then lets the request through, presses "Try again",
// and makes the next load fail to get the "could not be updated" notice above
// the old list. It runs at 1440 (table) and 390 (cards).
//
// Output, in tests/layout-check/out/ (or LAYOUT_CHECK_OUT):
//   shots/<label>/loadfail-<view>-<width>.png and loadfail-leads-stale-<width>.png
//   reports/loadfail-<label>.json
//
// Safety: the same as capture.mjs. The browser can only reach the local app
// and cannot send it anything but GET requests.

import fs from "node:fs";
import path from "node:path";
import {
  NOANIM_CSS,
  assertLabel,
  assertLocalUrl,
  firstLine,
  loadPlaywright,
  needSettings,
  newSafeContext,
  outPath,
  parseArgs,
  signIn,
} from "./lib.mjs";

const USAGE = `Usage: node tests/layout-check/loadfail.mjs <app address> <label>
Example: node tests/layout-check/loadfail.mjs http://127.0.0.1:3111 after`;

const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 390, h: 844 },
];
// needle: the start of the message when the list cannot be loaded at all.
// stale: the notice when a list is on screen and the next load fails.
const CASES = [
  {
    view: "leads",
    path: "/leads",
    api: "/api/leads",
    needle: "Your leads could not be loaded",
    stale: "This list could not be updated",
  },
  { view: "buyers", path: "/buyers", api: "/api/buyers", needle: "Your buyers could not be loaded", stale: null },
];

// Runs in the page. Is the message (and its "Try again" button) drawn, inside
// the page, on screen and not cut?
const MEASURE = (needle) => {
  const main = document.querySelector("main");
  const drawn = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const mr = main.getBoundingClientRect();
  const left = Math.max(0, mr.left);
  const right = Math.min(innerWidth, mr.left + main.clientWidth);
  const r1 = (v) => Math.round(v * 10) / 10;
  // Cut by itself, or pushed outside a box that hides or scrolls its overflow.
  const cutInfo = (el) => {
    if (el.scrollWidth > el.clientWidth + 1) return "its own text is wider than its box";
    const r = el.getBoundingClientRect();
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible") continue;
      const ar = a.getBoundingClientRect();
      const ax = ar.left + a.clientLeft;
      if (r.left < ax - 0.5 || r.right > ax + a.clientWidth + 0.5) {
        const slot = a.getAttribute("data-slot");
        return `outside a box that hides or scrolls (${a.tagName.toLowerCase()}${slot ? `[${slot}]` : ""})`;
      }
    }
    return null;
  };
  const describe = (el) => {
    if (!drawn(el)) return { drawn: false };
    const r = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0.5).map((q) => Math.round(q.top)));
    return {
      drawn: true,
      text: el.textContent.trim().replace(/\s+/g, " "),
      insidePage: r.left >= left - 0.5 && r.right <= right + 0.5,
      onScreen: r.top >= 0 && r.bottom <= innerHeight,
      cut: cutInfo(el),
      lines: tops.size,
      width: r1(r.width),
      height: r1(r.height),
    };
  };
  const middle = (el) => {
    const r = el.getBoundingClientRect();
    return (r.top + r.bottom) / 2;
  };
  const message = [...main.querySelectorAll("span, p, div, td")].find(
    (e) => drawn(e) && e.childElementCount === 0 && e.textContent.includes(needle)
  );
  const isTryAgain = (b) => drawn(b) && b.textContent.trim() === "Try again";
  const scope = message ? message.closest("td, [data-slot=card], [data-leads-view], .flex") || main : main;
  const button =
    [...scope.querySelectorAll("button")].find(isTryAgain) || [...main.querySelectorAll("button")].find(isTryAgain);
  const cards = document.querySelector("[data-leads-view=cards], [data-buyers-view=cards]");
  const tableBox = [...main.querySelectorAll("[data-slot=table-container]")].find(drawn);
  const toast = [...document.querySelectorAll("[data-sonner-toast]")].find(drawn);
  const tr = toast ? toast.getBoundingClientRect() : null;
  return {
    // "div.md:hidden" is how code from before pull request 5 marks its card list.
    shape: [...main.querySelectorAll("table")].some(drawn)
      ? "table"
      : drawn(cards) || [...main.querySelectorAll("div.md\\:hidden")].some(drawn)
        ? "cards"
        : "message only",
    message: message ? describe(message) : { drawn: false },
    tryAgain: button
      ? {
          ...describe(button),
          disabled: button.disabled,
          besideMessage: message ? Math.abs(middle(message) - middle(button)) < 10 : null,
        }
      : { drawn: false },
    emptyTextShown: [...main.querySelectorAll("p, td, div")].some(
      (e) => drawn(e) && e.childElementCount === 0 && /^(No leads found|No buyers yet)$/.test(e.textContent.trim())
    ),
    pageSideways: document.documentElement.scrollWidth > innerWidth || main.scrollWidth > main.clientWidth + 1,
    tableSideways: tableBox ? tableBox.scrollWidth > tableBox.clientWidth + 1 : null,
    toast: toast
      ? {
          text: toast.innerText.trim().replace(/\s+/g, " "),
          insideScreen: tr.left >= 0 && tr.right <= innerWidth && tr.top >= 0 && tr.bottom <= innerHeight,
          cut: toast.scrollWidth > toast.clientWidth + 1,
        }
      : null,
  };
};

function line(s) {
  if (!s) return "n/a";
  const m = s.message;
  const t = s.tryAgain;
  const message = m.drawn
    ? `drawn, ${m.lines} line(s), ${m.insidePage ? "inside the page" : "OUTSIDE THE PAGE"}, ${m.onScreen ? "on screen" : "below the fold"}, ${m.cut ? `CUT: ${m.cut}` : "not cut"}`
    : "NOT DRAWN";
  const button = t.drawn
    ? `drawn, ${t.insidePage ? "inside the page" : "OUTSIDE THE PAGE"}, ${t.cut ? `CUT: ${t.cut}` : "not cut"}, ${t.besideMessage ? "beside the message" : "on its own line"}`
    : "none";
  const table = s.tableSideways == null ? "n/a" : s.tableSideways ? "YES" : "no";
  const toast = s.toast
    ? `"${s.toast.text.slice(0, 80)}" ${s.toast.insideScreen ? "inside the screen" : "OUTSIDE THE SCREEN"}${s.toast.cut ? ", CUT" : ""}`
    : "none";
  return (
    `${s.shape}; message ${message}; "Try again" ${button}; sideways scroll: page ${s.pageSideways ? "YES" : "no"}, table ${table}; ` +
    `empty-list text shown ${s.emptyTextShown ? "YES" : "no"}; toast ${toast}`
  );
}

function readCommandLine() {
  const { rest } = parseArgs(process.argv.slice(2));
  if (rest.length !== 2) throw new Error("Give the app address and a label.");
  return {
    base: assertLocalUrl(rest[0]),
    label: assertLabel(rest[1]),
    settings: needSettings(["DEMO_USER_EMAIL", "DEMO_USER_PASSWORD"]),
    chromium: loadPlaywright().chromium,
  };
}

async function main() {
  let cli;
  try {
    cli = readCommandLine();
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(1);
  }
  const { base, label, settings, chromium } = cli;
  const shots = outPath("shots", label);
  const reportFile = path.join(outPath("reports"), `loadfail-${label}.json`);
  fs.rmSync(reportFile, { force: true });

  const out = {
    tool: "tests/layout-check",
    label,
    baseUrl: base,
    started: new Date().toISOString(),
    results: {},
    blockedWrites: 0,
    notes: [],
  };
  const browser = await chromium.launch();
  try {
    for (const vp of WIDTHS) {
      const ctx = await newSafeContext(browser, {
        width: vp.w,
        height: vp.h,
        appOrigin: base,
        onBlockedWrite: () => out.blockedWrites++,
      });
      const page = await ctx.newPage();
      await signIn(page, {
        base,
        email: settings.DEMO_USER_EMAIL,
        password: settings.DEMO_USER_PASSWORD,
        note: (msg) => out.notes.push(`sign-in at ${vp.w}: ${msg}`),
      });

      for (const c of CASES) {
        const key = `${c.view}-${vp.w}`;
        const res = (out.results[key] = {});
        console.log(`== ${key}`);
        let failing = true;
        let failed = 0;
        const isListRequest = (url) => url.pathname === c.api;
        await page.route(isListRequest, (route) => {
          if (route.request().method() !== "GET" || !failing) return route.fallback();
          failed++;
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Internal server error" }),
          });
        });
        await page.goto(`${base}${c.path}`, { waitUntil: "domcontentloaded" });
        await page
          .waitForLoadState("networkidle", { timeout: 20000 })
          .catch(() => out.notes.push(`${key}: the page never went quiet`));
        await page
          .getByText(c.needle)
          .locator("visible=true")
          .first()
          .waitFor({ state: "visible", timeout: 15000 })
          .catch(() => out.notes.push(`${key}: the message never appeared`));
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await page.addStyleTag({ content: NOANIM_CSS });
        await page.waitForTimeout(700);
        res.load = await page.evaluate(MEASURE, c.needle);
        res.load.requestsAnswered500 = failed;
        await page.screenshot({ path: path.join(shots, `loadfail-${key}.png`) });

        if (res.load.tryAgain.drawn) {
          // Let the request through again and press "Try again": does the list come back?
          failing = false;
          await page.locator("main button", { hasText: "Try again" }).locator("visible=true").first().click();
          const back = await page
            .locator('main a[href^="tel:"] >> visible=true')
            .first()
            .waitFor({ state: "visible", timeout: 15000 })
            .then(
              () => true,
              () => false
            );
          await page.waitForTimeout(400);
          res.retry = await page.evaluate(() => ({
            phoneLinksDrawn: [...document.querySelectorAll('main a[href^="tel:"]')].filter(
              (a) => a.getClientRects().length
            ).length,
            messageGone: ![...document.querySelectorAll("main span")].some(
              (e) => e.getClientRects().length && /could not be loaded/.test(e.textContent)
            ),
          }));
          res.retry.listCameBack = back;

          if (c.stale && back) {
            // "Could not update": the list is on screen, then the next load is refused.
            // Changing the status filter makes the page load the list again (a GET).
            failing = true;
            for (const close of await page.locator("[data-sonner-toast] button[data-close-button]").all()) {
              await close.click().catch(() => {});
            }
            await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
            await page.locator("main [data-slot=select-trigger]", { hasText: "All Statuses" }).first().click();
            await page.getByRole("option", { name: "Under Contract" }).click();
            await page
              .getByText(c.stale)
              .locator("visible=true")
              .first()
              .waitFor({ state: "visible", timeout: 15000 })
              .catch(() => out.notes.push(`${key}: the "could not be updated" notice never appeared`));
            await page.addStyleTag({ content: NOANIM_CSS });
            await page.waitForTimeout(700);
            res.stale = await page.evaluate(MEASURE, c.stale);
            res.stale.phoneLinksStillDrawn = await page.evaluate(
              () =>
                [...document.querySelectorAll('main a[href^="tel:"]')].filter((a) => a.getClientRects().length).length
            );
            await page.screenshot({ path: path.join(shots, `loadfail-${c.view}-stale-${vp.w}.png`) });
          }
        }
        await page.unroute(isListRequest);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  out.finished = new Date().toISOString();
  fs.writeFileSync(reportFile, JSON.stringify(out, null, 2));

  console.log("");
  for (const [key, v] of Object.entries(out.results)) {
    console.log(`${key}, could not load: ${line(v.load)}`);
    if (v.retry) {
      console.log(
        `${key}, after "Try again": list came back ${v.retry.listCameBack ? "yes" : "NO"}, ` +
          `${v.retry.phoneLinksDrawn} phone links drawn, message gone ${v.retry.messageGone ? "yes" : "NO"}`
      );
    }
    if (v.stale) {
      console.log(
        `${key}, could not update: ${line(v.stale)}; phone links still drawn ${v.stale.phoneLinksStillDrawn}`
      );
    }
  }
  console.log(
    `\nNotes: ${out.notes.length ? out.notes.join("; ") : "none"}. Blocked write calls: ${out.blockedWrites}.`
  );
  console.log(`Wrote ${reportFile}`);
  console.log(`Pictures: ${shots} (loadfail-*.png)`);
}

main().catch((err) => {
  console.error(`The check failed, so no report was written: ${firstLine(err)}`);
  console.error("Is the app running? Check with: node tests/layout-check/serve.mjs status");
  process.exit(1);
});
