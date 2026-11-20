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
// another <button> is still open.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
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
    assert.equal(res.status, 200, `${page.path}: ${res.status} ${res.location ?? ""}`);
    if (page.signedIn) {
      // Every dashboard page has the sidebar buttons; none means the page did not render.
      assert.match(res.text, /<button/, `${page.path}: no button in the HTML, so the check would prove nothing`);
    }
    const nested = nestedButtons(res.text);
    assert.deepEqual(nested, [], `${page.path}: button inside a button:\n${nested.join("\n")}`);
  });
}
