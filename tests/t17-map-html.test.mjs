// T17. Lead and buyer text can never become markup on the map page
// (review finding F-XSS-MAP).
//
// Part 1 tests the html tag in lib/safe-html.ts directly (Node loads the
// TypeScript file as is). Part 2 reads components/map/map-view.tsx and fails
// if any popup, tooltip or icon HTML is built without the tag.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { html, escapeHtml, SafeHtml } from "../lib/safe-html.ts";

const root = process.env.TEST_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HOSTILE = [
  `<img src=x onerror="alert(1)">`,
  `"><script>alert(1)</script>`,
  `' onmouseover='alert(1)`,
  `</div><svg onload=alert(1)>`,
  `&lt;b&gt; already encoded`,
  "<img\nsrc=y\nonerror=alert(1)>",
];

// After escaping, no raw markup character from the value may survive.
function assertInert(out, label) {
  const stripped = out
    .replace(/<\/?(div|span|a|strong|br)( [a-z-]+="[^"<>]*")*\s*\/?>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, "");
  assert.doesNotMatch(stripped, /[<>"']/, `${label}: raw markup left in ${JSON.stringify(out)}`);
}

test("T17 escapeHtml escapes the five markup characters", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeHtml("plain text 123"), "plain text 123");
});

test("T17 every hostile value is escaped in text position", () => {
  for (const v of HOSTILE) {
    const out = html`<span>${v}</span>`.toString();
    assert.ok(out.startsWith("<span>") && out.endsWith("</span>"), out);
    assertInert(out, "text");
    assert.ok(!out.includes("<img") && !out.includes("<script") && !out.includes("<svg"), out);
  }
});

test("T17 every hostile value is escaped inside double-quoted attributes, including tel: and mailto: links", () => {
  for (const v of HOSTILE) {
    for (const out of [
      html`<a href="tel:${v}">x</a>`.toString(),
      html`<a href="mailto:${v}">x</a>`.toString(),
      html`<div style="background: ${v};"></div>`.toString(),
    ]) {
      // The attribute value must stay one attribute: exactly the two quotes the template wrote.
      assert.equal(out.split('"').length - 1, 2, out);
      assertInert(out, "attribute");
    }
  }
});

test("T17 numbers are stringified and escaped; null, undefined and false render as nothing", () => {
  assert.equal(html`<b>${42}</b>`.toString(), "<b>42</b>");
  assert.equal(html`<b>${null}${undefined}${false}</b>`.toString(), "<b></b>");
  assert.equal(html`<b>${0}</b>`.toString(), "<b>0</b>");
  assert.equal(html`<b>${""}</b>`.toString(), "<b></b>");
});

test("T17 nested fragments from the same tag are kept as markup, their values still escaped", () => {
  const inner = html`<em>${"<i>"}</em>`;
  assert.ok(inner instanceof SafeHtml);
  const out = html`<div>${inner}</div>`.toString();
  assert.equal(out, "<div><em>&lt;i&gt;</em></div>");
  const cond = (show) => html`<p>${show ? html`<br/>` : ""}</p>`.toString();
  assert.equal(cond(true), "<p><br/></p>");
  assert.equal(cond(false), "<p></p>");
});

test("T17 lists of fragments are joined; plain strings in a list are escaped", () => {
  const items = ["<a>", "b&c"].map((n) => html`<li>${n}</li>`);
  assert.equal(html`<ul>${items}</ul>`.toString(), "<ul><li>&lt;a&gt;</li><li>b&amp;c</li></ul>");
  assert.equal(html`<p>${["<x>", null, html`<br/>`]}</p>`.toString(), "<p>&lt;x&gt;<br/></p>");
});

test("T17 nothing but the tag itself can produce trusted markup", () => {
  const real = html`<b>ok</b>`;
  // A look-alike object, a forged prototype and a string with a toString are all escaped.
  const lookAlike = { toString: () => "<script>1</script>" };
  const forged = Object.create(SafeHtml.prototype);
  forged.toString = () => "<script>2</script>";
  const out = html`${lookAlike}${forged}${String(real)}`.toString();
  assert.ok(!out.includes("<script>"), out);
  assert.ok(out.includes("&lt;b&gt;ok&lt;/b&gt;"), "a fragment turned into a plain string is escaped again");
  assert.throws(() => new SafeHtml("<script>3</script>"), "the constructor cannot be called from outside");
});

// ---- Part 2: the map component only hands tagged markup to Leaflet ----

/**
 * Starting at `start` (just after an opening backtick), return the index just
 * after the matching closing backtick. Understands ${ ... } with nested
 * strings, templates and braces.
 */
function endOfTemplate(src, start) {
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
    } else if (c === "`") {
      return i + 1;
    } else if (c === "$" && src[i + 1] === "{") {
      i = endOfExpression(src, i + 2);
    } else {
      i++;
    }
  }
  throw new Error("unterminated template");
}

function endOfExpression(src, start) {
  let depth = 1;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === "`") {
      i = endOfTemplate(src, i + 1);
    } else if (c === '"' || c === "'") {
      i++;
      while (src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "{") {
      depth++;
      i++;
    } else if (c === "}") {
      depth--;
      i++;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  throw new Error("unterminated expression");
}

/** True if src at index i is exactly `html\`...\`.toString()` followed by `end`. */
function isTaggedThenToString(src, i, end) {
  const rest = src.slice(i).match(/^\s*html`/);
  if (!rest) return false;
  const after = endOfTemplate(src, i + rest[0].length);
  return new RegExp(`^\\.toString\\(\\)\\s*${end}`).test(src.slice(after));
}

test("T17 map-view.tsx passes only html-tagged markup to bindPopup, bindTooltip, setContent and divIcon", () => {
  const file = path.join(root, "components", "map", "map-view.tsx");
  const src = readFileSync(file, "utf8");
  assert.match(src, /from "@\/lib\/safe-html"/, "map-view.tsx imports the html tag");
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/, "no direct HTML sinks");

  const calls = [...src.matchAll(/\.(bindPopup|bindTooltip|setContent)\(/g)];
  assert.ok(calls.length >= 2, `expected the two popups, found ${calls.length} calls`);
  for (const m of calls) {
    const at = m.index + m[0].length;
    const line = src.slice(0, m.index).split("\n").length;
    assert.ok(
      isTaggedThenToString(src, at, "\\)"),
      `line ${line}: ${m[1]}() must get html\`...\`.toString() and nothing else`
    );
  }

  const icons = [...src.matchAll(/divIcon\(\s*\{/g)];
  assert.ok(icons.length >= 2, `expected the marker and zone label icons, found ${icons.length}`);
  for (const m of icons) {
    const body = src.slice(m.index, endOfExpression(src, m.index + m[0].length));
    const line = src.slice(0, m.index).split("\n").length;
    const htmlProps = [...body.matchAll(/\bhtml\s*:/g)];
    assert.equal(htmlProps.length, 1, `line ${line}: divIcon has one html property`);
    const at = m.index + htmlProps[0].index + htmlProps[0][0].length;
    assert.ok(isTaggedThenToString(src, at, "[,}]"), `line ${line}: divIcon html must be html\`...\`.toString()`);
  }
});
