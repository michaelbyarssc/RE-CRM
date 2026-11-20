// T26. No page sends HTML with a <button> inside another <button>.
//
// A browser does not allow a button inside a button: while it reads the HTML
// it closes the outer button first, so the page it builds no longer matches
// what React drew on the server. React then reports a hydration error
// ("Minified React error #418" in production) and draws the page again.
// This happened on /leads, /pipeline, /sequences, /buyers and /calendar when a
// dialog or menu trigger (itself a <button>) was wrapped around a <Button>.
// The fix is the trigger's `render` prop, which makes the two one button.
//
// The test finds every page.tsx under app/, requests its HTML (dashboard pages
// signed in, the others signed out) and fails if a <button> starts while
// another <button> is still open. The HTML check cannot see parts drawn after
// data loads (table rows), so a source scan also fails when a ...Trigger or
// ...Close tag without a `render` prop has a <button> or <Button> as its first child.
// The source scan is a simple text check. It does not see a button that reaches
// a trigger another way, for example through a prop ({trigger}) or as a second
// child. For anything that is in the first HTML, the HTML check does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./helpers/http.mjs";
import { USERS } from "./helpers/db.mjs";

const root = process.env.TEST_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findPages(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "api") findPages(full, out);
    } else if (name === "page.tsx" || name === "page.jsx" || name === "page.js") {
      out.push(full);
    }
  }
  return out;
}

/** [{ path: "/leads/1", signedIn: true }] for every page; route groups like (dashboard) are left out of the URL. */
function pages() {
  const appDir = path.join(root, "app");
  return findPages(appDir)
    .sort()
    .map((file) => {
      const parts = path.relative(appDir, path.dirname(file)).split(path.sep).filter(Boolean);
      const signedIn = parts[0] === "(dashboard)";
      const url = "/" + parts.filter((p) => !/^\(.*\)$/.test(p)).map((p) => p.replace(/^\[.+\]$/, "1")).join("/");
      return { path: url, signedIn };
    });
}

/** Every place where a <button> starts inside a <button> that is still open. */
export function nestedButtons(html) {
  // Script, style and template contents and comments are not markup the browser builds.
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, "");
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?)\/?>/g;
  const open = [];
  const found = [];
  for (const m of markup.matchAll(tag)) {
    if (m[2].toLowerCase() !== "button") continue;
    if (m[1] === "/") {
      open.pop();
    } else {
      if (open.length) found.push(`${open[open.length - 1]}  >  ${m[0].slice(0, 160)}`);
      open.push(m[0].slice(0, 160));
    }
  }
  return found;
}

test("T26 the nesting check itself finds a button in a button and nothing else", () => {
  assert.equal(nestedButtons(`<button a="1"><span>x</span></button><button>y</button>`).length, 0);
  assert.equal(nestedButtons(`<button data-slot="dialog-trigger"><button data-slot="button">Add</button></button>`).length, 1);
  assert.equal(nestedButtons(`<button title="a > b"><button>x</button></button>`).length, 1);
  assert.equal(nestedButtons(`<script>"<button><button>"</script><button>ok</button>`).length, 0);
});

const all = pages();

test("T26 the page list covers the screens that had the problem", () => {
  const paths = all.map((p) => p.path);
  for (const p of ["/leads", "/pipeline", "/sequences", "/buyers", "/calendar"]) {
    assert.ok(paths.includes(p), `${p} missing from ${paths.join(", ")}`);
  }
});

for (const page of all) {
  test(`T26 ${page.path} (${page.signedIn ? "signed in" : "signed out"}) has no <button> inside a <button>`, async () => {
    const res = await api(page.path, page.signedIn ? { user: USERS.A } : {});
    assert.equal(
      res.status,
      200,
      `${page.path} answered ${res.status} ${res.location ?? ""}, not 200, so its HTML was not checked. ` +
        `If the page is meant to redirect or needs other values in its address, adjust pages() in this test.`
    );
    if (page.signedIn) {
      // Every dashboard page has the sidebar buttons; none means the page did not render.
      assert.match(res.text, /<button/, `${page.path}: no button in the HTML, so the check would prove nothing`);
    }
    const nested = nestedButtons(res.text);
    assert.deepEqual(nested, [], `${page.path}: button inside a button:\n${nested.join("\n")}`);
  });
}

// ---- Source scan: triggers that are drawn only after data loads ----

/** "<Name> line N" for every ...Trigger / ...Close tag without `render` whose first child is a button. */
export function triggersWrappingButtons(source) {
  const found = [];
  for (const m of source.matchAll(/<([A-Z][\w.]*(?:Trigger|Close))\b/g)) {
    // Find the end of the opening tag, skipping {...} expressions and quoted strings.
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const attrs = source.slice(m.index + m[0].length, i);
    if (attrs.trimEnd().endsWith("/") || /(?:^|\s)render\s*=/.test(attrs)) continue;
    const child = source.slice(i + 1).replace(/^(\s|\{\/\*[\s\S]*?\*\/\})*/, "");
    if (/^<[Bb]utton\b/.test(child)) found.push(`${m[1]} line ${source.slice(0, m.index).split("\n").length}`);
  }
  return found;
}

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

test("T26 the source scan finds a trigger wrapped around a button and nothing else", () => {
  assert.deepEqual(triggersWrappingButtons(`<DialogTrigger>\n  <Button>Add</Button>\n</DialogTrigger>`), ["DialogTrigger line 1"]);
  assert.equal(triggersWrappingButtons(`<DropdownMenuTrigger className={cn("a", x > 1 && "b")}><button /></DropdownMenuTrigger>`).length, 1);
  assert.equal(triggersWrappingButtons(`<DialogTrigger render={<Button />}>Add</DialogTrigger>`).length, 0);
  assert.equal(triggersWrappingButtons(`<DropdownMenuTrigger><span className="x">+</span></DropdownMenuTrigger>`).length, 0);
  assert.equal(triggersWrappingButtons(`<SheetTrigger render={<Button variant="ghost" />}><Menu /></SheetTrigger>`).length, 0);
  // Only a prop named exactly `render` counts, not one that ends in it.
  assert.equal(triggersWrappingButtons(`<DialogTrigger data-render="x"><Button>Add</Button></DialogTrigger>`).length, 1);
});

test("T26 no trigger or close part in app/ or components/ wraps a <button> or <Button>", () => {
  const found = ["app", "components"].flatMap((d) =>
    sourceFiles(path.join(root, d)).flatMap((f) =>
      triggersWrappingButtons(readFileSync(f, "utf8")).map((hit) => `${path.relative(root, f)}: ${hit}`)
    )
  );
  assert.deepEqual(found, [], `use the render prop instead of a button child:\n${found.join("\n")}`);
});
