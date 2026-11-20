#!/usr/bin/env node
// Takes pictures of every main screen of the app at nine screen widths and
// measures the layout: text that is cut, boxes that scroll sideways, things
// that spill out of their box, lone last words, and a list of named spots.
//
//   node tests/layout-check/capture.mjs <app address> <label> [--views a,b] [--weight 500]
//   node tests/layout-check/capture.mjs http://127.0.0.1:3110 before
//   node tests/layout-check/capture.mjs http://127.0.0.1:3111 after
//
// Output, in tests/layout-check/out/ (or LAYOUT_CHECK_OUT):
//   shots/<label>/                  whole screens <view>-<width>.png and close-ups of the named spots
//   reports/detector-<label>.json   everything that was measured
//   reports/detector-<label>.md     the same as tables (made by report-rows.mjs)
//
// Options:
//   --views leads,calendar   only these views ("login" is a view too)
//   --weight 500             preview another base text weight. It adds
//                            "@layer base { * { font-weight: 500 } }" to every page,
//                            which acts like changing that number in app/globals.css.
//
// Safety: the app address must be on 127.0.0.1 or localhost. The browser
// blocks every request to another host and every call to the app that is not a
// GET (its /api/ routes and server actions), so a run cannot change saved data.
// One save call (the dialer's "Save Call Log") is answered inside the browser
// with a made-up success, so that a toast shows: it never reaches the app, and
// the report counts it. The settings GET is fetched as usual and then changed
// in the browser to look as if keys were saved.
//
// Never add the privacy page or the terms page to VIEWS: they print a real
// contact email, which must not end up in a picture.
//
// Needs Playwright with Chromium. It is not a dependency of this app on
// purpose (see README.md).

import fs from "node:fs";
import path from "node:path";
import {
  FIXED_TIME,
  NOANIM_CSS,
  assertLabel,
  assertLocalUrl,
  firstLine,
  loadPlaywright,
  needSettings,
  newSafeContext,
  outDir,
  outPath,
  parseArgs,
  signIn,
} from "./lib.mjs";
import {
  GENERIC,
  HELPERS,
  SIDEBAR_EMAIL_SEL,
  T_BUYERS,
  T_CALENDAR,
  T_DASH,
  T_DIALER,
  T_LEADS_PAGING,
  T_LEADS_TABLE,
  T_LEAD_CARDS,
  T_LOGIN,
  T_POPUP,
  T_SELECTS,
  T_SIDEBAR,
  T_TOAST,
  T_WELCOME,
} from "./detector.mjs";
import { countsFor, markdown } from "./report-rows.mjs";

// The four main widths: every view runs at each of them.
const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 800 },
  { w: 768, h: 1024 },
  { w: 390, h: 844 },
];
// Extra widths, for the listed views only. 1425 and 1265 are 1440 and 1280 with a
// visible 15 px scrollbar (a mouse on Windows or Linux): the page gets 15 px less
// room there, and that is where a table that just fits at 1440 or 1280 breaks.
// 1024 is a small laptop or a tablet on its side; 375 and 360 are small phones.
const EXTRA_WIDTHS = [
  { w: 1425, h: 900, only: ["buyers", "leads"] },
  { w: 1265, h: 800, only: ["buyers", "leads"] },
  { w: 1024, h: 768, only: ["buyers", "leads"] },
  { w: 375, h: 812, only: ["login", "settings", "dialer", "leads"] },
  { w: 360, h: 780, only: ["login", "settings", "dialer", "leads"] },
];
// A 34 character email used to test the side menu by replacing the text in the page.
const LONG_EMAIL = "office.manager.central@example.com";
// A small made-up CSV for the import page's file input. The page reads it in the browser
// to show the column mapping; nothing is imported.
const IMPORT_CSV =
  "First Name,Last Name,Property Address,City,State,Zip,Phone,Email\nJane,Doe,12 Vossy St,Spartanburg,SC,29301,(555) 010-0999,jane@example.com\n";
const LEAD_READY = 'main a[href^="tel:"] >> visible=true';
// The views. name: used in file names and in the report. path: the page. ready: something
// that is only on the page once its data has loaded (most often a text from the seed), so a
// picture is never taken of a half-loaded page.
const VIEWS = [
  { name: "welcome", path: "/welcome", ready: "main h1" },
  { name: "dashboard", path: "/", ready: "main h1" },
  { name: "leads", path: "/leads", ready: LEAD_READY },
  { name: "pipeline", path: "/pipeline", ready: "main >> text=Marcus Whitfield >> visible=true" },
  { name: "sequences", path: "/sequences", ready: "main >> text=New Lead Follow-up >> visible=true" },
  { name: "buyers", path: "/buyers", ready: "main >> text=Upstate Cash Homes >> visible=true" },
  { name: "calendar", path: "/calendar", ready: ".fc-daygrid-event >> visible=true" },
  { name: "dialer", path: "/dialer", ready: LEAD_READY },
  { name: "map", path: "/map", ready: ".leaflet-container" },
  { name: "skip-trace", path: "/skip-trace", ready: "main >> text=Marcus Whitfield >> visible=true" },
  { name: "settings", path: "/settings", ready: "main >> text=Skip Trace API Keys" },
  { name: "knowledge-base", path: "/knowledge-base", ready: "main h1" },
  // Two more pages that hold Select boxes.
  { name: "import-mapping", path: "/leads/import", ready: "main input[type=file]" },
  { name: "sequence-detail", path: "/sequences/{SEQ_ID}", ready: "main >> text=Add Step" },
];

const USAGE = `Usage: node tests/layout-check/capture.mjs <app address> <label> [--views a,b] [--weight 500]
Example: node tests/layout-check/capture.mjs http://127.0.0.1:3111 after
Views: login, ${VIEWS.map((v) => v.name).join(", ")}`;

function readCommandLine() {
  const { options, rest } = parseArgs(process.argv.slice(2), { values: ["views", "weight"] });
  if (rest.length !== 2) throw new Error("Give the app address and a label.");
  const known = ["login", ...VIEWS.map((v) => v.name)];
  const views = options.views
    ? options.views
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : null;
  const unknown = (views || []).filter((v) => !known.includes(v));
  if (unknown.length) throw new Error(`Unknown view: ${unknown.join(", ")}`);
  if (options.weight && !/^[1-9]00$/.test(options.weight)) throw new Error("--weight must be 100, 200, ... or 900");
  const settings = needSettings(["DEMO_USER_EMAIL", "DEMO_USER_PASSWORD"]);
  return {
    base: assertLocalUrl(rest[0]),
    label: assertLabel(rest[1]),
    views,
    weight: options.weight || null,
    email: settings.DEMO_USER_EMAIL,
    password: settings.DEMO_USER_PASSWORD,
    chromium: loadPlaywright().chromium,
  };
}

let cli;
try {
  cli = readCommandLine();
} catch (err) {
  console.error(err.message);
  console.error(USAGE);
  process.exit(1);
}
const { base: BASE, label, views: ONLY_VIEWS, weight: WEIGHT, email: EMAIL, password: PASSWORD, chromium } = cli;
const WEIGHT_CSS = WEIGHT ? `@layer base { * { font-weight: ${WEIGHT}; } }` : null;
const SHOTS = outPath("shots", label);
const REPORTS = outPath("reports");
const REPORT_JSON = path.join(REPORTS, `detector-${label}.json`);
const REPORT_MD = path.join(REPORTS, `detector-${label}.md`);

// What the run collects.
const blockedHosts = new Map();
const blockedWrites = [];
const fakedWrites = []; // write calls answered inside the browser with a made-up success (never reach the app)
const consoleErrors = {}; // view -> width -> [messages]
const results = {}; // view -> width -> {...}
const warnings = [];
let currentView = "(none)";
let loginHtml = null;
let seqId = null;
let baseWeightSeen = null; // the font weight a plain element has on the page
let currentWidth = 0;

function note(msg) {
  warnings.push(`[${currentView} ${currentWidth}] ${msg}`);
  console.log(`  warning: ${msg}`);
}

// A browser window of one width that can only reach the local app (see lib.mjs).
function newContext(browser, vp) {
  return newSafeContext(browser, {
    width: vp.w,
    height: vp.h,
    appOrigin: BASE,
    onBlockedHost: (host) => blockedHosts.set(host, (blockedHosts.get(host) || 0) + 1),
    onBlockedWrite: (call) => blockedWrites.push({ view: currentView, width: currentWidth, ...call }),
  });
}

function watchConsole(page) {
  const push = (text) => {
    consoleErrors[currentView] ??= {};
    (consoleErrors[currentView][currentWidth] ??= []).push(text.slice(0, 300));
  };
  page.on("console", (m) => {
    if (m.type() === "error") push(m.text());
  });
  page.on("pageerror", (e) => push(`pageerror: ${e.message}`));
}

async function settle(page, ready) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => note("networkidle timeout"));
  if (ready) {
    await page
      .locator(ready)
      .first()
      .waitFor({ state: "attached", timeout: 20000 })
      .catch(() => note(`ready selector not found: ${ready}`));
  }
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll("main *")].some(
          (e) => e.childElementCount === 0 && e.textContent.trim() === "Loading..." && e.getClientRects().length
        ),
      null,
      { timeout: 15000 }
    )
    .catch(() => note("still showing Loading..."));
  if (WEIGHT_CSS) await page.addStyleTag({ content: WEIGHT_CSS });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.addStyleTag({ content: NOANIM_CSS });
  await page.waitForTimeout(500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled", caret: "hide" });
}

// rect: {x, y, width, height} in viewport pixels. Adds a margin and clamps to the viewport.
async function crop(page, name, rect, margin = 16) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    note(`crop ${name}: no rectangle`);
    return null;
  }
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(rect.x - margin));
  const y = Math.max(0, Math.floor(rect.y - margin));
  const right = Math.min(vp.width, Math.ceil(rect.x + rect.width + margin));
  const bottom = Math.min(vp.height, Math.ceil(rect.y + rect.height + margin));
  if (right - x < 4 || bottom - y < 4) {
    note(`crop ${name}: outside the viewport`);
    return null;
  }
  const clip = { x, y, width: right - x, height: bottom - y };
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), clip, animations: "disabled", caret: "hide" });
  return `${name}.png`;
}

// ---------------------------------------------------------------- pictures and checks for each view
//
// Several close-ups below hand the page a piece of JavaScript as text (rectOf).
// It is text, not a function, because the pieces are put together from shared
// starts (COLS, LIST) and from conditions that differ per close-up. It runs in
// the page, where it can only read the document.
async function evalFn(page, fn, arg) {
  await page.evaluate(HELPERS);
  return arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg);
}

// Crop around the visible Select trigger(s) matched in root, with their label row.
async function selectCrop(page, name, root) {
  const r = await rectOf(
    page,
    `const t = [...document.querySelectorAll(arg + " [data-slot=select-trigger]")].find((e) => e.getClientRects().length);
    if (!t) return null; t.scrollIntoView({ block: "center" }); const box = (t.closest(".space-y-2") || t.parentElement).getBoundingClientRect(); const a = t.getBoundingClientRect();
    const left = Math.min(box.left, a.left); return { x: left, y: Math.min(box.top, a.top), width: Math.max(box.right, a.right) - left, height: Math.max(box.bottom, a.bottom) - Math.min(box.top, a.top) };`,
    root
  );
  return crop(page, name, r, 12);
}

async function rectOf(page, fnBody, arg) {
  return page.evaluate(
    ({ fnBody, arg }) => {
      const r = new Function("arg", fnBody)(arg);
      if (!r) return null;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    { fnBody, arg }
  );
}

async function leadsSpots(page, vp, out) {
  // Table or cards: whichever block is drawn (cards are shown on tablets and phones).
  await page.evaluate(HELPERS);
  const shape = await page.evaluate(() =>
    window.__lt.leadsTable() ? "table" : window.__lt.leadsCards() ? "cards" : "none"
  );
  out.leadsShape = shape;
  // Cells are found by header text, so the checks survive a column that is added or removed.
  const COLS = `const t = window.__lt.leadsTable(); const names = [...t.querySelectorAll("thead th")].map((th) => th.innerText.trim());
      const col = (n) => names.indexOf(n);`;
  if (shape === "table") {
    out.table = await evalFn(page, T_LEADS_TABLE);
    // Right edge: last ~560 px of the visible table, header plus first 6 rows.
    const r = await rectOf(
      page,
      `${COLS}
      const c = t.parentElement; const m = document.querySelector("main");
      const cr = c.getBoundingClientRect(); const right = Math.min(cr.left + c.clientWidth, m.getBoundingClientRect().left + m.clientWidth, innerWidth);
      const rows = t.querySelectorAll("tbody tr"); const last = rows[Math.min(5, rows.length - 1)].getBoundingClientRect();
      const top = t.querySelector("thead").getBoundingClientRect().top;
      const left = Math.max(cr.left, right - 560);
      return { x: left, y: top, width: right - left, height: last.bottom - top };`
    );
    out.crops.push(await crop(page, `leads-table-right-edge-${vp.w}`, r, 12));
    const full = await rectOf(
      page,
      `${COLS}
      const c = t.parentElement; const cr = c.getBoundingClientRect();
      const rows = t.querySelectorAll("tbody tr"); const last = rows[Math.min(7, rows.length - 1)].getBoundingClientRect();
      return { x: cr.left, y: cr.top, width: Math.min(cr.width, innerWidth - cr.left), height: last.bottom - cr.top };`
    );
    out.crops.push(await crop(page, `leads-table-full-${vp.w}`, full, 12));
    if (out.table.containerScroll?.has) {
      await page.evaluate(() => {
        const c = window.__lt.leadsTable().parentElement;
        c.scrollLeft = c.scrollWidth;
      });
      await page.waitForTimeout(100);
      out.crops.push(await crop(page, `leads-table-full-scrolled-${vp.w}`, full, 12));
      await page.evaluate(() => {
        window.__lt.leadsTable().parentElement.scrollLeft = 0;
      });
    }
    // Status box: the first Under Contract row, from the cell before Status to the Tags cell.
    const shifted = await page.evaluate(() => {
      const t = window.__lt.leadsTable();
      const c = t.parentElement;
      const names = [...t.querySelectorAll("thead th")].map((th) => th.innerText.trim());
      const si = names.indexOf("Status"),
        ti = names.indexOf("Tags");
      const tr = [...t.querySelectorAll("tbody tr")].find((r) =>
        /Under Contract/.test(r.querySelector("[data-slot=select-trigger]")?.innerText || "")
      );
      if (!tr) return 0;
      const cell = tr.children[ti].getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      const visRight = Math.min(cr.left + c.clientWidth, innerWidth);
      if (cell.right <= visRight) return 0;
      c.scrollLeft = tr.children[si - 1].offsetLeft - 8;
      return c.scrollLeft;
    });
    if (shifted) await page.waitForTimeout(100);
    const sb = await rectOf(
      page,
      `${COLS}
      const tr = [...t.querySelectorAll("tbody tr")].find((r) => /Under Contract/.test(r.querySelector("[data-slot=select-trigger]")?.innerText || ""));
      if (!tr) return null; const a = tr.children[col("Status") - 1].getBoundingClientRect(); const b = tr.children[col("Tags")].getBoundingClientRect();
      return { x: a.left, y: a.top, width: Math.min(b.right, innerWidth) - a.left, height: a.height };`
    );
    out.crops.push(await crop(page, `status-box-${vp.w}`, sb, 14));
    if (shifted) {
      out.statusBoxCropNote = `table box scrolled sideways by ${shifted}px for this picture`;
      await page.evaluate(() => {
        window.__lt.leadsTable().parentElement.scrollLeft = 0;
      });
    }
  } else if (shape === "cards") {
    out.cards = await evalFn(page, T_LEAD_CARDS);
    const LIST = `const list = window.__lt.leadsCards(); const cards = [...list.children].filter((c) => c.querySelector("[data-slot=select-trigger]"));`;
    const cardRect = (pred) =>
      rectOf(
        page,
        `${LIST}
      const c = cards.find((c) => (${pred})(c)); if (!c) return null; c.scrollIntoView({ block: "center" }); return c.getBoundingClientRect();`
      );
    const tiredPred = `(c) => { const t = [...c.querySelectorAll("[data-slot=badge]")].map((b) => b.innerText.trim()); return t.length === 1 && t[0] === "Tired Landlord"; }`;
    const ucPred = `(c) => /Under Contract/.test(c.querySelector("[data-slot=select-trigger]").innerText)`;
    const longPred = `(c) => /Christopher & Angela Martinez/.test(c.innerText)`;
    await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
    // First three cards together (two side by side when the list has two columns).
    const three = await rectOf(
      page,
      `${LIST}
      const a = cards[0].getBoundingClientRect(); const b = cards[Math.min(2, cards.length - 1)].getBoundingClientRect();
      const right = Math.max(...cards.slice(0, 3).map((c) => c.getBoundingClientRect().right));
      return { x: a.left, y: a.top, width: Math.min(right, innerWidth) - a.left, height: Math.min(b.bottom, innerHeight) - a.top };`
    );
    out.crops.push(await crop(page, `lead-card-${vp.w}`, three, 10));
    out.crops.push(await crop(page, `lead-card-tired-${vp.w}`, await cardRect(tiredPred), 10));
    out.crops.push(await crop(page, `lead-card-uc-${vp.w}`, await cardRect(ucPred), 10));
    out.crops.push(await crop(page, `lead-card-long-name-${vp.w}`, await cardRect(longPred), 10));
    const st = await rectOf(
      page,
      `${LIST}
      const c = cards.find((c) => /Under Contract/.test(c.querySelector("[data-slot=select-trigger]")?.innerText || ""));
      c.scrollIntoView({ block: "center" }); const r = c.getBoundingClientRect(); const s = c.querySelector("[data-slot=select-trigger]").getBoundingClientRect();
      const left = Math.max(r.left, s.left - 150); return { x: left, y: Math.min(r.top, s.top - 8), width: Math.min(r.right, innerWidth) - left + 8, height: s.bottom - Math.min(r.top, s.top - 8) + 8 };`
    );
    out.crops.push(await crop(page, `status-box-${vp.w}`, st, 10));
    await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
  } else note("no leads table or cards drawn");
}

// A status filter Select set to "Under Contract" (a filter only: the page reads
// with GET, nothing is saved). Is the arrow inside the box, is the text cut?
async function statusFilterSpot(page, vp, out, key) {
  const trig = page.locator("main [data-slot=select-trigger]", { hasText: "All Statuses" }).first();
  if (!(await trig.count())) {
    note(`${key}: no status filter`);
    return;
  }
  await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
  await trig.click();
  await page.getByRole("option", { name: "Under Contract" }).click();
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: NOANIM_CSS });
  out[key] = await page.evaluate(() => {
    const t = [...document.querySelectorAll("main [data-slot=select-trigger]")].find(
      (e) => /Under Contract/.test(e.innerText) && !e.closest("[data-leads-view], table, .md\\:hidden")
    );
    if (!t) return { error: "filter not found" };
    const r = t.getBoundingClientRect();
    const svgs = t.querySelectorAll("svg");
    const a = svgs[svgs.length - 1].getBoundingClientRect();
    return {
      width: Math.round(r.width),
      arrowInside: a.right <= r.right + 0.5,
      arrowPastPx: Math.round((a.right - r.right) * 10) / 10,
      contentNeeds: t.scrollWidth,
      clientWidth: t.clientWidth,
    };
  });
  const r = await rectOf(
    page,
    `const t = [...document.querySelectorAll("main [data-slot=select-trigger]")].find((e) => /Under Contract/.test(e.innerText) && !e.closest("[data-leads-view], table, .md\\\\:hidden")); return t ? t.getBoundingClientRect() : null;`
  );
  out.crops.push(await crop(page, `${key}-${vp.w}`, r, 14));
}

async function sidebarSpot(page, vp, out) {
  if (vp.w < 768) {
    const btn = page.locator("div.md\\:hidden.fixed [data-slot=sheet-trigger], div.md\\:hidden.fixed button").first();
    await btn.click();
    await page
      .locator("[data-slot=sheet-content]")
      .waitFor({ state: "visible", timeout: 5000 })
      .catch(() => note("menu did not open"));
    await page.addStyleTag({ content: NOANIM_CSS });
    await page.waitForTimeout(400);
  }
  await page
    .waitForFunction(
      (sel) =>
        [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length && e.textContent.includes("@")),
      SIDEBAR_EMAIL_SEL,
      { timeout: 8000 }
    )
    .catch(() => note("email never appeared"));
  out.sidebar = await evalFn(page, T_SIDEBAR);
  const emailRect = () =>
    rectOf(
      page,
      `
    const el = [...document.querySelectorAll(arg)].find((e) => e.getClientRects().length);
    if (!el) return null; const box = (el.closest("aside") || el.closest("[data-slot=sheet-content]")).getBoundingClientRect(); const e = el.getBoundingClientRect();
    const top = Math.max(box.top, e.top - 60); return { x: box.left, y: top, width: box.width + 40, height: Math.min(box.bottom, e.bottom + 90) - top };`,
      SIDEBAR_EMAIL_SEL
    );
  out.crops.push(await crop(page, `sidebar-email-${vp.w}`, await emailRect(), 8));
  // The same spot with a 34 character email: replace only the text, keep the elements.
  const saved = await page.evaluate(
    ({ sel, email }) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length);
      if (!el) return null;
      const texts = [];
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = tw.nextNode())) if (t.data.trim()) texts.push(t);
      const before = texts.map((x) => x.data);
      window.__ltEmail = { texts, before };
      const at = email.indexOf("@");
      if (texts.length >= 2) {
        texts[0].data = email.slice(0, at);
        texts[1].data = email.slice(at);
        for (const x of texts.slice(2)) x.data = "";
      } else if (texts.length === 1) texts[0].data = email;
      return before;
    },
    { sel: SIDEBAR_EMAIL_SEL, email: LONG_EMAIL }
  );
  await page.waitForTimeout(100);
  out.sidebarLong = await evalFn(page, T_SIDEBAR);
  out.crops.push(await crop(page, `sidebar-email-long-${vp.w}`, await emailRect(), 8));
  if (saved)
    await page
      .evaluate(() => {
        const s = window.__ltEmail;
        if (s)
          s.texts.forEach((t, i) => {
            t.data = s.before[i];
          });
      })
      .catch(() => {});
  if (vp.w < 768) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}

async function viewSpots(page, view, vp, out) {
  switch (view.name) {
    case "leads": {
      await leadsSpots(page, vp, out);
      await sidebarSpot(page, vp, out);
      // Add Lead dialog: the Status box (opening the dialog saves nothing).
      await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
      await page.getByRole("button", { name: "Add Lead" }).last().click();
      await page
        .locator("[role=dialog] [data-slot=select-trigger]")
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .catch(() => note("Add Lead dialog did not open"));
      await page.addStyleTag({ content: NOANIM_CSS });
      await page.waitForTimeout(300);
      out.selectsAddLead = await evalFn(page, T_SELECTS, "[role=dialog]");
      out.crops.push(await selectCrop(page, `select-add-lead-${vp.w}`, "[role=dialog]"));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      // Heading count and paging bar (the bar is at the bottom of the list).
      out.paging = await evalFn(page, T_LEADS_PAGING);
      await page.waitForTimeout(150);
      if (out.paging.rect) {
        const r = out.paging.rect;
        out.crops.push(
          await crop(page, `leads-paging-${vp.w}`, { x: r.x, y: r.y - 150, width: r.width, height: r.height + 150 }, 10)
        );
      }
      await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
      if (!vp.only) await statusFilterSpot(page, vp, out, "filter-leads");
      break;
    }
    case "dashboard": {
      out.dash = await evalFn(page, T_DASH);
      const r = await rectOf(
        page,
        `const c = [...document.querySelectorAll("main [data-slot=card]")].find((c) => /Upcoming Events/.test(c.textContent));
        if (!c) return null; c.scrollIntoView({ block: "start" }); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, innerHeight - r.y) };`
      );
      out.crops.push(await crop(page, `dashboard-upcoming-${vp.w}`, r, 8));
      break;
    }
    case "map": {
      if (vp.only) break;
      const marker = page.locator(".leaflet-marker-pane .custom-marker");
      await marker
        .first()
        .waitFor({ state: "attached", timeout: 10000 })
        .catch(() => note("no lead marker"));
      // Click the marker nearest the middle of the map (always inside the view).
      const idx = await page.evaluate(() => {
        const m = document.querySelector(".leaflet-container").getBoundingClientRect();
        const cx = (m.left + m.right) / 2,
          cy = (m.top + m.bottom) / 2;
        let best = -1,
          bd = Infinity;
        [...document.querySelectorAll(".leaflet-marker-pane .custom-marker")].forEach((e, i) => {
          const r = e.getBoundingClientRect();
          if (r.width === 0) return;
          const d = Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        return best;
      });
      if (idx >= 0) {
        // Send the click to the marker itself (on a phone, markers overlap each other).
        await marker.nth(idx).dispatchEvent("click");
        await page
          .locator(".leaflet-popup-content")
          .first()
          .waitFor({ state: "visible", timeout: 5000 })
          .catch(() => note("popup did not open"));
        await page.waitForTimeout(400);
        out.popup = await evalFn(page, T_POPUP);
        const r = await rectOf(
          page,
          `const p = document.querySelector(".leaflet-popup"); return p ? p.getBoundingClientRect() : null;`
        );
        out.crops.push(await crop(page, `map-popup-${vp.w}`, r, 12));
      }
      await page.keyboard.press("Escape");
      await statusFilterSpot(page, vp, out, "filter-map");
      break;
    }
    case "import-mapping": {
      out.selectsImportMapping = await evalFn(page, T_SELECTS);
      out.crops.push(await selectCrop(page, `select-import-mapping-${vp.w}`, "main"));
      break;
    }
    case "sequence-detail": {
      out.selectsSequence = await evalFn(page, T_SELECTS);
      out.crops.push(await selectCrop(page, `select-sequence-${vp.w}`, "main"));
      break;
    }
    case "welcome": {
      out.heading = await evalFn(page, T_WELCOME);
      const r = await rectOf(
        page,
        `const h = [...document.querySelectorAll("main h1")].find((e) => /Welcome to/.test(e.textContent)); h.scrollIntoView({block:"center"});
        const p = h.nextElementSibling; const a = h.getBoundingClientRect(); const b = (p || h).getBoundingClientRect();
        return { x: Math.min(a.left, b.left), y: a.top, width: Math.max(a.right, b.right) - Math.min(a.left, b.left), height: b.bottom - a.top };`
      );
      out.crops.push(await crop(page, `welcome-heading-${vp.w}`, r, 16));
      break;
    }
    case "calendar": {
      out.calendar = await evalFn(page, T_CALENDAR);
      const r = await rectOf(
        page,
        `
        const a = document.querySelector('td[data-date="2026-11-03"]'); const b = document.querySelector('td[data-date="2026-11-18"]');
        if (!a || !b) return null; const ra = a.closest("tr").getBoundingClientRect(); const rb = b.closest("tr").getBoundingClientRect();
        return { x: ra.left, y: ra.top, width: ra.width, height: rb.bottom - ra.top };`
      );
      if (r && r.y + r.height > vp.h) {
        await page.evaluate(() =>
          document.querySelector('td[data-date="2026-11-03"]').scrollIntoView({ block: "start" })
        );
        await page.waitForTimeout(150);
      }
      const r2 = await rectOf(
        page,
        `
        const a = document.querySelector('td[data-date="2026-11-03"]'); const b = document.querySelector('td[data-date="2026-11-18"]');
        if (!a || !b) return null; const ra = a.closest("tr").getBoundingClientRect(); const rb = b.closest("tr").getBoundingClientRect();
        return { x: ra.left, y: ra.top - 30, width: ra.width, height: rb.bottom - ra.top + 30 };`
      );
      out.crops.push(await crop(page, `calendar-month-${vp.w}`, r2, 8));
      // Last two weeks (the all-day event on Dec 4) and the toolbar.
      await page.evaluate(() =>
        document.querySelector('td[data-date="2026-11-29"]')?.scrollIntoView({ block: "center" })
      );
      await page.waitForTimeout(150);
      const r3 = await rectOf(
        page,
        `
        const a = document.querySelector('td[data-date="2026-11-29"]'); const b = document.querySelector('td[data-date="2026-12-06"]');
        if (!a || !b) return null; const ra = a.closest("tr").getBoundingClientRect(); const rb = b.closest("tr").getBoundingClientRect();
        return { x: ra.left, y: ra.top, width: ra.width, height: rb.bottom - ra.top };`
      );
      out.crops.push(await crop(page, `calendar-month-end-${vp.w}`, r3, 8));
      await page.evaluate(() => document.querySelector(".fc-header-toolbar")?.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(150);
      const r4 = await rectOf(
        page,
        `const t = document.querySelector(".fc-header-toolbar"); return t ? t.getBoundingClientRect() : null;`
      );
      out.crops.push(await crop(page, `calendar-toolbar-${vp.w}`, r4, 10));
      if (vp.w === 1440 || vp.w === 390) {
        for (const [btn, nm] of [
          ["timeGridWeek", "week"],
          ["timeGridDay", "day"],
          ["listWeek", "list"],
        ]) {
          await page.locator(`.fc-${btn}-button`).click();
          await page.waitForTimeout(500);
          await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
          await page.evaluate(() => document.querySelector(".fc-header-toolbar")?.scrollIntoView({ block: "start" }));
          await page.waitForTimeout(200);
          await shot(page, `calendar-${nm}-${vp.w}`);
          ((results[`calendar-${nm}`] ??= {})[vp.w] = { crops: [] }).generic = await evalFn(page, GENERIC);
        }
        await page.locator(".fc-dayGridMonth-button").click();
        await page.waitForTimeout(300);
      }
      break;
    }
    case "skip-trace": {
      out.selectsExport = await evalFn(page, T_SELECTS);
      const r = await rectOf(
        page,
        `const t = document.querySelector("main [data-slot=select-trigger]"); t.scrollIntoView({block:"center"});
        const h = t.closest("[data-slot=card-header]") || t.parentElement; const a = h.getBoundingClientRect(); return { x: a.left, y: a.top, width: a.width, height: a.height };`
      );
      out.crops.push(await crop(page, `skiptrace-format-${vp.w}`, r, 8));
      // The Import tab has a second format box. Switching tabs changes nothing saved.
      await page.locator("main [role=tab]", { hasText: "Import Results" }).click();
      await page.waitForTimeout(300);
      await page.evaluate(HELPERS);
      out.selectsImport = await evalFn(page, T_SELECTS);
      const r2 = await rectOf(
        page,
        `const t = [...document.querySelectorAll("main [data-slot=select-trigger]")].find((e) => e.getClientRects().length);
        if (!t) return null; t.scrollIntoView({block:"center"}); const a = t.getBoundingClientRect(); const c = t.closest("[data-slot=card-content]").getBoundingClientRect();
        return { x: c.left, y: a.top - 40, width: c.width, height: a.height + 50 };`
      );
      out.crops.push(await crop(page, `skiptrace-format-import-${vp.w}`, r2, 8));
      break;
    }
    case "buyers": {
      out.buyers = await evalFn(page, T_BUYERS);
      const r = await rectOf(
        page,
        `
        const b = [...document.querySelectorAll("main [data-slot=badge]")].find((e) => e.textContent.trim() === "On Map" && e.getClientRects().length);
        if (!b) return null; const row = b.closest("tr") || b.closest("[data-slot=card]"); row.scrollIntoView({block:"center"}); const r = row.getBoundingClientRect();
        return { x: r.left, y: r.top, width: Math.min(r.width, innerWidth - r.left), height: r.height };`
      );
      out.crops.push(await crop(page, `buyers-on-map-${vp.w}`, r, 10));
      break;
    }
    case "dialer": {
      out.dialer = await evalFn(page, T_DIALER);
      // The card with the smallest gap between address and call button.
      const r = await rectOf(
        page,
        `
        const cards = [...document.querySelectorAll("main [data-slot=card]")].filter((c) => c.querySelector('a[href^="tel:"]') && c.getClientRects().length);
        let best = null, bestGap = Infinity;
        for (const c of cards) { const p = c.querySelector("p.text-xs"); const b = c.querySelector('a[href^="tel:"]').getBoundingClientRect();
          const g = b.left - window.__lt.textRight(p); if (g < bestGap) { bestGap = g; best = c; } }
        if (!best) return null; best.scrollIntoView({block:"center"}); const r = best.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };`
      );
      out.crops.push(await crop(page, `dialer-card-${vp.w}`, r, 10));
      if (vp.only) break;
      // Power dialer card (mono font), the Log Call dialog (disposition box) and a toast.
      await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
      await page.getByRole("button", { name: "Power Dialer" }).click();
      await page
        .locator("main p.font-mono")
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .catch(() => note("power dialer card did not show"));
      out.monoFont = await page.evaluate(() => {
        const e = document.querySelector("main p.font-mono");
        return e ? getComputedStyle(e).fontFamily : null;
      });
      await page.getByRole("button", { name: "Log Call" }).click();
      await page
        .locator("[role=dialog] [data-slot=select-trigger]")
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .catch(() => note("Log Call dialog did not open"));
      await page.addStyleTag({ content: NOANIM_CSS });
      await page.waitForTimeout(300);
      out.selectsDisposition = await evalFn(page, T_SELECTS, "[role=dialog]");
      out.crops.push(await selectCrop(page, `select-disposition-${vp.w}`, "[role=dialog]"));
      // Answer the save call inside the browser with a made-up success; nothing reaches the app.
      await page.route("**/api/calls", async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        fakedWrites.push({ view: currentView, width: currentWidth, method: "POST", path: "/api/calls" });
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: 999999, ok: true }),
        });
      });
      await page.getByRole("button", { name: "Save Call Log" }).click();
      await page
        .locator("[data-sonner-toast]")
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .catch(() => note("no toast"));
      await page.waitForTimeout(600);
      out.toast = await evalFn(page, T_TOAST);
      const tr = await rectOf(
        page,
        `const t = [...document.querySelectorAll("[data-sonner-toast]")].find((e) => e.getClientRects().length); return t ? t.getBoundingClientRect() : null;`
      );
      out.crops.push(await crop(page, `toast-${vp.w}`, tr, 16));
      await page.unroute("**/api/calls");
      break;
    }
    case "settings": {
      const g = results.settings?.[vp.w]?.generic;
      const clipped = (g?.placeholders || []).filter((p) => p.clipped);
      out.settingsHints = {
        placeholders: g?.placeholders || [],
        clipped: clipped.map((p) => `${p.id}: "${p.placeholder}" needs ${p.need}px, has ${p.avail}px`),
      };
      const targetId = clipped[0]?.id || (g?.placeholders || [])[0]?.id;
      if (targetId) {
        const r = await rectOf(
          page,
          `const i = document.getElementById(arg); if (!i) return null; i.scrollIntoView({block:"center"});
          const wrap = i.closest(".space-y-2") || i.parentElement; const c = i.closest("[data-slot=card-content]") || wrap; const a = wrap.getBoundingClientRect(); const cc = c.getBoundingClientRect();
          return { x: cc.left, y: a.top, width: cc.width, height: a.height };`,
          targetId
        );
        out.crops.push(await crop(page, `settings-hint-${vp.w}`, r, 10));
      }
      // The same fields when a value is already saved: the settings GET is answered with
      // "saved" for every secret key (read only; nothing is saved).
      await page.route("**/api/settings", async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const res = await route.fetch();
        let data = {};
        try {
          data = await res.json();
        } catch {}
        data.secrets = data.secrets || {};
        for (const k of [
          "reiskip_api_key",
          "batchskiptracing_api_key",
          "skipengine_api_key",
          "twilio_account_sid",
          "twilio_auth_token",
        ])
          data.secrets[k] = { set: true, last4: "4821" };
        return route.fulfill({ response: res, json: data });
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await settle(page, "main >> text=Saved, ends in 4821");
      const gs = await evalFn(page, GENERIC);
      const cs = gs.placeholders.filter((p) => p.clipped);
      out.settingsSaved = {
        placeholders: gs.placeholders,
        clipped: cs.map((p) => `${p.id}: "${p.placeholder}" needs ${p.need}px, has ${p.avail}px`),
        orphans: gs.orphans.filter((o) => o.inViewport).length,
      };
      const target2 = cs[0]?.id || "batchskiptracing_api_key";
      const r5 = await rectOf(
        page,
        `const i = document.getElementById(arg); if (!i) return null; i.scrollIntoView({block:"center"});
        const wrap = i.closest(".space-y-2") || i.parentElement; const c = i.closest("[data-slot=card-content]") || wrap; const a = wrap.getBoundingClientRect(); const cc = c.getBoundingClientRect();
        return { x: cc.left, y: a.top, width: cc.width, height: a.height };`,
        target2
      );
      out.crops.push(await crop(page, `settings-hint-saved-${vp.w}`, r5, 10));
      await page.unroute("**/api/settings");
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------- the run
async function main() {
  // A run that fails must not leave an older report behind under the same label.
  fs.rmSync(REPORT_JSON, { force: true });
  fs.rmSync(REPORT_MD, { force: true });
  console.log(`Capturing ${BASE} as "${label}" into ${outDir()}`);
  const browser = await chromium.launch();
  const started = new Date().toISOString();
  try {
    // The login page's raw HTML (tests/t15-login-no-sign-up.test.mjs reads the same thing).
    {
      const ctx = await newContext(browser, WIDTHS[0]);
      const res = await ctx.request.get(`${BASE}/login`);
      const htmlText = await res.text();
      loginHtml = {
        status: res.status(),
        hasExactNotice: htmlText.includes("Accounts are for Deal Desk Pro customers only."),
        signUpWording: /sign[\s-]?up/i.test(htmlText),
        createAccountWording: /create (an )?account/i.test(htmlText),
        passwordField: htmlText.includes('type="password"'),
      };
      await ctx.close();
    }
    for (const vp of [...WIDTHS, ...EXTRA_WIDTHS]) {
      currentWidth = vp.w;
      console.log(`== width ${vp.w}${vp.only ? ` (only ${vp.only.join(", ")})` : ""}`);

      // Signed out: the login page.
      currentView = "login";
      if ((!vp.only || vp.only.includes("login")) && (!ONLY_VIEWS || ONLY_VIEWS.includes("login"))) {
        const ctx = await newContext(browser, vp);
        const page = await ctx.newPage();
        watchConsole(page);
        await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
        await settle(page, "form button[type=submit]");
        await shot(page, `login-${vp.w}`);
        const out = { crops: [] };
        out.generic = await evalFn(page, GENERIC);
        out.login = await evalFn(page, T_LOGIN);
        const r = await rectOf(
          page,
          `const el = [...document.querySelectorAll("div")].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Accounts are for Deal Desk Pro customers only.");
          if (!el) return null; const card = el.closest("[data-slot=card]").getBoundingClientRect(); const btn = document.querySelector("form button[type=submit]").getBoundingClientRect(); const e = el.getBoundingClientRect();
          return { x: card.left, y: btn.top, width: card.width, height: e.bottom - btn.top };`
        );
        out.crops.push(await crop(page, `login-notice-${vp.w}`, r, 16));
        (results.login ??= {})[vp.w] = out;
        await ctx.close();
      }
      const views = VIEWS.filter(
        (v) => (!vp.only || vp.only.includes(v.name)) && (!ONLY_VIEWS || ONLY_VIEWS.includes(v.name))
      );
      if (!views.length) continue;

      // Signed in through the real login page.
      currentView = "sign-in";
      const ctx = await newContext(browser, vp);
      const page = await ctx.newPage();
      watchConsole(page);
      await signIn(page, { base: BASE, email: EMAIL, password: PASSWORD, note });
      if (seqId == null) {
        // GET only: the id of the "New Lead Follow-up" sequence for the sequence page.
        seqId = await page
          .evaluate(async () => {
            const r = await fetch("/api/sequences");
            const d = await r.json();
            const list = Array.isArray(d) ? d : d.sequences || [];
            const s = list.find((x) => x.name === "New Lead Follow-up") || list[0];
            return s ? s.id : null;
          })
          .catch(() => null);
        if (seqId == null) note("no sequence id found");
      }

      for (const view of views) {
        currentView = view.name;
        console.log(`  ${view.name}`);
        await page.goto(`${BASE}${view.path.replace("{SEQ_ID}", String(seqId))}`, { waitUntil: "domcontentloaded" });
        await settle(page, view.ready);
        if (baseWeightSeen == null) {
          baseWeightSeen = await page.evaluate(
            () => getComputedStyle(document.querySelector("main") || document.body).fontWeight
          );
        }
        if (view.name === "import-mapping") {
          // Give the file input a small made-up CSV. The page reads it in the browser and
          // shows the column mapping; the Import button is never pressed.
          await page
            .locator("main input[type=file]")
            .first()
            .setInputFiles({ name: "sample.csv", mimeType: "text/csv", buffer: Buffer.from(IMPORT_CSV) });
          await page
            .locator("main [data-slot=select-trigger]")
            .first()
            .waitFor({ state: "visible", timeout: 10000 })
            .catch(() => note("mapping did not appear"));
          await settle(page, null);
        }
        if (new URL(page.url()).pathname.startsWith("/login")) note("redirected to login");
        await shot(page, `${view.name}-${vp.w}`);
        const out = { crops: [] };
        out.generic = await evalFn(page, GENERIC);
        (results[view.name] ??= {})[vp.w] = out;
        try {
          await viewSpots(page, view, vp, out);
        } catch (e) {
          note(`spot step failed: ${firstLine(e)}`);
        }
        out.crops = out.crops.filter(Boolean);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  const report = {
    tool: "tests/layout-check",
    label,
    baseUrl: BASE,
    started,
    finished: new Date().toISOString(),
    fixedBrowserTime: FIXED_TIME,
    options: { views: ONLY_VIEWS, weight: WEIGHT },
    baseWeightSeen,
    widths: WIDTHS,
    extraWidths: EXTRA_WIDTHS,
    blockedHosts: Object.fromEntries(blockedHosts),
    blockedWrites,
    fakedWrites,
    loginHtml,
    warnings,
    consoleErrors,
    results,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_MD, markdown(report));

  console.log(`\nWrote ${REPORT_JSON}`);
  console.log(`      ${REPORT_MD}`);
  console.log(`Pictures: ${SHOTS}`);
  console.log("\nIn view, all views: width | clipped | sideways scroll | spills | lone last words");
  for (const vp of [...WIDTHS, ...EXTRA_WIDTHS]) {
    const c = countsFor(report, vp.w);
    console.log(`  ${String(vp.w).padStart(4)} | ${c.clipped} | ${c.sideways} | ${c.spills} | ${c.loneWords}`);
  }
  console.log(
    `Warnings: ${warnings.length}. Blocked write calls: ${blockedWrites.length}. ` +
      `Write calls answered in the browser: ${fakedWrites.length}.`
  );
  if (warnings.length) {
    console.log(
      "A run with warnings did not measure everything. Read them in the report, fix the cause and run again."
    );
  }
}

main().catch((err) => {
  console.error(`The capture failed, so no report was written for "${label}": ${firstLine(err)}`);
  console.error(`Is the app running on ${BASE}? Check with: node tests/layout-check/serve.mjs status`);
  process.exit(1);
});
