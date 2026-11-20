// T27. No screen puts a button inside a button, or a link inside a link
// (React hydration error on /leads, /pipeline, /buyers, /calendar and
// /sequences, QA pass of 2026-11-19).
//
// A browser cannot nest these two tags: it closes the outer one first. The
// page the browser builds then differs from what React expects, and React
// reports a hydration error. The usual cause is a <Button> written inside a
// Base UI trigger (DialogTrigger, DropdownMenuTrigger and the like), which
// already renders its own <button>. The fix is the `render` prop:
// <DialogTrigger render={<Button />}>Label</DialogTrigger>.
//
// Part 1 fetches each screen as the server sends it and scans the HTML.
// What it guarantees: no <button> opens while another <button> is open, and
// no <a> opens while another <a> is open, in the HTML the server sends.
// Comments, the inside of <script>, <style>, <textarea> and <title>, and
// attribute values are skipped, so the page data React sends inside scripts
// never counts.
// What it cannot see: anything the screen draws only in the browser, after
// its data has loaded (for example the note button on each lead row, or the
// bulk actions menu). Part 2 covers those by reading the source files.
//
// Part 2 parses the .tsx files under app/ and components/ (not components/ui)
// with the TypeScript parser and fails when a JSX element whose name ends in
// Trigger or Close (not SubTrigger, which renders a div) has no `render` prop
// and has a <Button> or <button> as its first child element (spaces and line
// breaks between tags do not count). It cannot see a button passed in
// through a prop or an expression (for example {trigger}); Part 1 sees those
// when the server draws them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, USERS } from "./helpers/db.mjs";
import { ts, parseSource, syntaxErrors, forEachNode, lineOf, listSourceFiles } from "./helpers/source-scan.mjs";

const root = process.env.TEST_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- The HTML scanner ----

const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const WATCHED = ["button", "a"];

/** Short, one-line piece of html around index, for failure messages. */
function excerpt(html, index, before = 160, after = 140) {
  const start = Math.max(0, index - before);
  const piece = html.slice(start, index + after).replace(/\s+/g, " ");
  return `${start > 0 ? "..." : ""}${piece}...`;
}

/**
 * Returns [{ tag, index }] for every <button> that opens inside an open
 * <button>, and every <a> that opens inside an open <a>.
 */
function findNestedTags(html) {
  const open = { button: 0, a: 0 };
  const found = [];
  let i = 0;
  while ((i = html.indexOf("<", i)) >= 0) {
    if (html.startsWith("<!--", i)) {
      const e = html.indexOf("-->", i + 4);
      i = e < 0 ? html.length : e + 3;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i, i + 80));
    if (!m) {
      i++;
      continue;
    }
    // The end of the tag, skipping quoted attribute values (they may hold < or >).
    let k = i + m[0].length;
    let quote = null;
    while (k < html.length) {
      const c = html[k];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      k++;
    }
    const end = k + 1;
    const name = m[2].toLowerCase();
    const closing = m[1] === "/";
    if (!closing && RAW_TEXT.has(name)) {
      const e = html.toLowerCase().indexOf(`</${name}`, end);
      i = e < 0 ? html.length : e;
      continue;
    }
    if (WATCHED.includes(name)) {
      if (closing) {
        open[name] = Math.max(0, open[name] - 1);
      } else {
        if (open[name] > 0) found.push({ tag: name, index: i });
        open[name]++;
      }
    }
    i = end;
  }
  return found;
}

test("T27 the HTML scanner finds a button inside a button and a link inside a link", () => {
  const html = `<div><button type="button" data-slot="dialog-trigger"><button class="btn">Add Lead</button></button>
    <a href="/x"><span><a href="/y">y</a></span></a></div>`;
  const found = findNestedTags(html);
  assert.deepEqual(
    found.map((f) => f.tag),
    ["button", "a"]
  );
  assert.equal(html.slice(found[0].index, found[0].index + 21), '<button class="btn">A');
});

test("T27 the HTML scanner passes a clean page with buttons and links side by side", () => {
  const html = `<!DOCTYPE html><html><body><button>One</button><button disabled>Two</button>
    <a href="/a">A</a><a href="/b"><span>B</span></a><BUTTON>Three</BUTTON><abbr>x</abbr><area></body></html>`;
  assert.deepEqual(findNestedTags(html), []);
});

test("T27 the HTML scanner ignores buttons in scripts, styles, comments and attribute values", () => {
  const html = `<button>Open
    <script>self.__next_f.push([1,"<button>inside a script string</button><a href=x>"])</script>
    <style>button::after{content:"<button>"}</style>
    <!-- <button> in a comment -->
    <span title="<button> in an attribute" data-x='<a href="z">'>ok</span>
  </button><a href="/q">q</a>`;
  assert.deepEqual(findNestedTags(html), []);
});

// ---- Part 1: the screens as the server sends them ----

let ids;
before(async () => {
  ids = await reseed();
});
after(closeDb);

// Signed in as user A, then signed out. The two detail screens use seeded ids.
const SIGNED_IN = [
  "/",
  "/leads",
  "/pipeline",
  "/buyers",
  "/calendar",
  "/sequences",
  "/dialer",
  "/map",
  "/settings",
  "/skip-trace",
  "/knowledge-base",
  "/welcome",
  "/leads/import",
];
const SCREENS = [
  ...SIGNED_IN.map((p) => ({ label: p, path: () => p, user: USERS.A })),
  { label: "/leads/<seeded lead>", path: (seed) => `/leads/${seed.aLead}`, user: USERS.A },
  { label: "/sequences/<seeded sequence>", path: (seed) => `/sequences/${seed.aSeq}`, user: USERS.A },
  ...["/login", "/privacy", "/terms"].map((p) => ({ label: `${p} (signed out)`, path: () => p, user: undefined })),
];

for (const screen of SCREENS) {
  test(`T27 ${screen.label} has no button inside a button and no link inside a link`, async () => {
    const p = screen.path(ids);
    const user = screen.user;
    const res = await api(p, { user });
    assert.equal(res.status, 200, `${p}: answered ${res.status} ${res.location ?? ""}`);
    assert.match(res.headers.get("content-type") || "", /text\/html/, `${p}: not an HTML page`);
    assert.match(res.text, /<html[\s>]/i, `${p}: no <html> tag`);
    const found = findNestedTags(res.text);
    const lines = found.map(
      (f) => `- a <${f.tag}> opens inside another <${f.tag}>: ${excerpt(res.text, f.index)}`
    );
    assert.ok(
      found.length === 0,
      `The screen ${p} has ${found.length} nested tag(s). The browser repairs this and React then reports a hydration error. ` +
        `Fix: give the trigger a render prop, <DialogTrigger render={<Button />}>Label</DialogTrigger>, instead of a <Button> inside it.\n` +
        lines.join("\n")
    );
  });
}

// ---- Part 2: the source files, for parts drawn only in the browser ----

/** The tag name as written, for example "DialogTrigger" or "DialogPrimitive.Close". */
function tagName(element) {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  return opening.tagName.getText();
}

/**
 * Returns [{ trigger, child, line }] for every Trigger or Close element with
 * no render prop whose first child element is a Button or a button.
 */
function findTriggersWrappingButtons(src, fileName = "sample.tsx") {
  const sf = parseSource(fileName, src);
  const errors = syntaxErrors(sf);
  if (errors.length) throw new Error(`${fileName} has syntax errors: ${errors.join("; ")}`);
  const found = [];
  forEachNode(sf, (n) => {
    if (!ts.isJsxElement(n)) return;
    const trigger = tagName(n);
    if (!/(Trigger|Close)$/.test(trigger) || /SubTrigger$/.test(trigger)) return;
    const hasRender = n.openingElement.attributes.properties.some(
      (a) => ts.isJsxAttribute(a) && a.name.getText() === "render"
    );
    if (hasRender) return;
    const first = n.children.find((c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces));
    if (!first || !(ts.isJsxElement(first) || ts.isJsxSelfClosingElement(first))) return;
    const child = tagName(first);
    if (child === "Button" || child === "button") found.push({ trigger, child, line: lineOf(sf, n) });
  });
  return found;
}

test("T27 the source scanner finds a Button written inside a trigger and passes the render prop form", () => {
  const bad = `const page = (<>
    <DialogTrigger>
      <Button onClick={() => setOpen(true)}>Add</Button>
    </DialogTrigger>
    <DropdownMenuTrigger className="x">
      <button className="y">+</button>
    </DropdownMenuTrigger>
    <p>Don't click (here) {count}</p>
  </>);`;
  assert.deepEqual(
    findTriggersWrappingButtons(bad).map((f) => `${f.trigger} ${f.child} line ${f.line}`),
    ["DialogTrigger Button line 2", "DropdownMenuTrigger button line 5"],
    "a trigger with a button inside is found, also with an apostrophe in the text after it"
  );
  const good = `const page = (<>
    <DialogTrigger render={<Button variant="outline" />}>Add</DialogTrigger>
    <SheetTrigger
      render={
        <Button variant="ghost" size="icon" className="mr-3" />
      }
    >
      <Menu />
    </SheetTrigger>
    <DropdownMenuSubTrigger><span>Tags</span></DropdownMenuSubTrigger>
    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
    <DialogTrigger>{trigger}</DialogTrigger>
  </>);`;
  assert.deepEqual(findTriggersWrappingButtons(good), []);
});

test("T27 no trigger in the source files has a Button written inside it", () => {
  const files = listSourceFiles(root, ["app", "components"], { pattern: /\.tsx$/, skip: ["app/api", "components/ui"] });
  assert.ok(files.length > 30, `found only ${files.length} .tsx files`);
  const lines = [];
  for (const rel of files) {
    for (const f of findTriggersWrappingButtons(readFileSync(path.join(root, rel), "utf8"), rel)) {
      lines.push(`- ${rel} line ${f.line}: <${f.trigger}> has a <${f.child}> inside it`);
    }
  }
  assert.ok(
    lines.length === 0,
    `${lines.length} trigger(s) wrap a button, which puts a button inside a button in the browser. ` +
      `Fix: move the button into the render prop, <DialogTrigger render={<Button />}>Label</DialogTrigger>.\n` +
      lines.join("\n")
  );
});
