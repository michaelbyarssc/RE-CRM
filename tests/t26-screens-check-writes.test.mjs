// T26. Every screen checks the server's answer after a save, change or delete
// (QA pass of 2026-11-19: several screens showed success after a refused write).
//
// This test reads the source files; it needs no running app. It parses every
// .ts and .tsx file under app/ (except app/api/) and under components/ with
// the TypeScript parser (tests/helpers/source-scan.mjs) and enforces three
// rules on the tree:
//
//   W1. No write (POST, PUT, PATCH or DELETE) is sent with plain fetch().
//       Writes go through apiFetch() from "@/lib/api-fetch".
//   W2. Every apiFetch() call is written as `const <name> = await apiFetch(`,
//       so the answer is kept.
//   W3. After that statement, in the same block, `<name>.ok` is read before
//       the answer's body is read and before the next apiFetch() call.
//
// What the scan guarantees:
// - It reads the code exactly as the build does. Comments, strings, template
//   text, regular expressions and JSX text never count as code, and
//   apiFetch() is never read as fetch().
// - W1: every call of fetch, window.fetch, globalThis.fetch or self.fetch with a second
//   argument is reported unless that argument is an inline object whose
//   `method` is the string "GET" or "HEAD" (any quotes, any letter case), or
//   that has no `method` and no ...spread. A method the scan cannot read (a
//   variable, a ternary, a shorthand `method`, a computed key) and options it
//   cannot see (a variable instead of an inline object) are reported too,
//   because the scan cannot prove they are reads.
// - W2: the apiFetch() call is directly the operand of `await`, and that
//   `await` is directly the value of a `const` with a plain name.
// - W3: in the statements that follow the declaration in the same block (the
//   only place a const can be used), the first of these three things is a
//   read of `<name>.ok`: a read of `<name>.ok`; a call of `<name>.json()`,
//   `.text()`, `.blob()`, `.arrayBuffer()` or `.formData()`; another
//   apiFetch() call.
// - Every scanned file has no syntax errors, so no file passes unread.
//
// What the scan cannot guarantee:
// - That the code does the right thing after the `.ok` test (shows an error,
//   keeps the form open). It only proves the test is there, in the right
//   place. The screens themselves are checked by hand and in the browser.
// - That `<name>.ok` guards every path: `if (x && res.ok)`, or `res.ok` read
//   inside a nested function that never runs, both count. A variable of the
//   same name declared again in a nested function is not told apart.
// - Writes sent another way: a fetch function stored under another name, new
//   Request(...), XMLHttpRequest, navigator.sendBeacon, or server actions in
//   lib/actions/. None of these is used by the screens today.
// - Some shapes that would work are reported on purpose: an answer read as
//   res["ok"], a destructured `const { ok } = await apiFetch(...)`, a helper
//   that tests the answer for you (`if (await failed(res))`), a wrapper that
//   returns apiFetch(...), and a fetch() method held in a constant. The rules
//   ask for the plain form so the scan can be sure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ts, parseSource, parseRepoFile, syntaxErrors, forEachNode, lineOf, listSourceFiles } from "./helpers/source-scan.mjs";

const root = process.env.TEST_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- The scanner ----

const READ_VERB = /^(get|head)$/i;
const WRITE_VERB = /^(post|put|patch|delete)$/i;
const BODY_READERS = new Set(["json", "text", "blob", "arrayBuffer", "formData"]);

/** The text of a string literal or a template without ${ }, else null. */
function literalText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

/** The name of an object property as written, or null when it is computed. */
function propertyName(prop) {
  const name = prop.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

/** True for fetch(...), window.fetch(...) and globalThis.fetch(...). */
function isFetchCall(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === "fetch";
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "fetch" &&
    ts.isIdentifier(callee.expression) &&
    ["window", "globalThis", "self"].includes(callee.expression.text)
  );
}

function isApiFetchCall(node) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "apiFetch";
}

/** Why a fetch() call may be a write, or null when it is surely a read. */
function writeReason(call) {
  const options = call.arguments[1];
  if (!options) return null; // fetch(url) is a GET
  if (!ts.isObjectLiteralExpression(options)) {
    return "its options are not written inline, so the scan cannot tell whether it is a read";
  }
  if (options.properties.some((p) => ts.isSpreadAssignment(p))) {
    return "its options use ...spread, so the scan cannot tell whether it is a read";
  }
  for (const prop of options.properties) {
    const name = propertyName(prop);
    if (name === null) return "its options have a computed key, so the scan cannot tell whether it is a read";
    if (name !== "method") continue;
    if (!ts.isPropertyAssignment(prop)) {
      return "its method is a variable, so the scan cannot tell whether it is a read";
    }
    const verb = literalText(prop.initializer);
    if (verb !== null && READ_VERB.test(verb)) return null;
    if (verb !== null && WRITE_VERB.test(verb)) return `it sends ${verb.toUpperCase()}`;
    let found = null;
    forEachNode(prop.initializer, (n) => {
      const t = literalText(n);
      if (!found && t !== null && WRITE_VERB.test(t)) found = t.toUpperCase();
    });
    return found ? `it sends ${found}` : `its method (${prop.initializer.getText().slice(0, 40)}) may be a write`;
  }
  return null;
}

/** The finding for one apiFetch() call (rules W2 and W3), or null. */
function checkApiFetch(call, line) {
  const awaited = call.parent;
  const decl = awaited && awaited.parent;
  const list = decl && decl.parent;
  if (
    !ts.isAwaitExpression(awaited) ||
    !ts.isVariableDeclaration(decl) ||
    decl.initializer !== awaited ||
    !ts.isIdentifier(decl.name) ||
    !ts.isVariableDeclarationList(list) ||
    (list.flags & ts.NodeFlags.Const) === 0
  ) {
    return { rule: "W2", line, detail: "the answer is not kept in a const" };
  }
  const name = decl.name.text;
  const statement = list.parent;
  const block = statement && statement.parent;
  const statements = block && block.statements;
  if (!ts.isVariableStatement(statement) || !statements) {
    return { rule: "W3", line, detail: `the scan cannot find the block where ${name} is used` };
  }
  // The first event after the declaration decides.
  let first = null;
  const isName = (n) => n && ts.isIdentifier(n) && n.text === name;
  for (const s of statements.slice(statements.indexOf(statement) + 1)) {
    forEachNode(s, (n) => {
      if (first) return;
      if (ts.isPropertyAccessExpression(n) && isName(n.expression) && n.name.text === "ok") first = "ok";
      else if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        isName(n.expression.expression) &&
        BODY_READERS.has(n.expression.name.text)
      )
        first = "body";
      else if (isApiFetchCall(n)) first = "next";
    });
    if (first) break;
  }
  if (first === "ok") return null;
  if (first === "body") return { rule: "W3", line, detail: `${name} is read before ${name}.ok is tested` };
  return { rule: "W3", line, detail: `${name}.ok is never tested after this call` };
}

/**
 * Scans one source file. Returns { findings, apiFetchCalls }, where each
 * finding is { rule: "W1" | "W2" | "W3" | "READ", line, detail }.
 */
function scanSource(src, fileName = "sample.tsx") {
  const sf = parseSource(fileName, src);
  const errors = syntaxErrors(sf);
  if (errors.length) {
    return { findings: errors.map((e) => ({ rule: "READ", line: Number(e.match(/\d+/)[0]), detail: e })), apiFetchCalls: 0 };
  }
  const findings = [];
  let apiFetchCalls = 0;
  forEachNode(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    if (isFetchCall(n)) {
      const reason = writeReason(n);
      if (reason) findings.push({ rule: "W1", line: lineOf(sf, n), detail: reason });
    } else if (isApiFetchCall(n)) {
      apiFetchCalls++;
      const finding = checkApiFetch(n, lineOf(sf, n));
      if (finding) findings.push(finding);
    }
  });
  return { findings, apiFetchCalls };
}

const PLAIN = {
  READ: "The TypeScript parser found syntax errors in these files, so the test cannot check them. Fix: make the file build again (npm run build shows the same error).",
  W1: "A save, change or delete is sent with plain fetch(), so a refused write can go unnoticed. Fix: send it with apiFetch() from \"@/lib/api-fetch\" and test res.ok before showing success.",
  W2: "apiFetch() is called without keeping the answer, so the screen cannot know if the write was refused. Fix: write it as `const res = await apiFetch(...)` and test res.ok next.",
  W3: "The answer of apiFetch() is not checked before the screen moves on, so it can show success after a refused write. Fix: add `if (!res.ok) { toast.error(await apiErrorMessage(res, ...)); return; }` right after the call.",
};

/** One line per problem: file, line, rule and what is wrong. */
function explain(file, f) {
  return `${file} line ${f.line}, rule ${f.rule}: ${f.detail}`;
}

/** The whole failure message: what the rule means, how to fix it, then each place. */
function failureMessage(rule, lines) {
  return `Rule ${rule}, ${lines.length} place(s). ${PLAIN[rule]}\n${lines.join("\n")}`;
}

// ---- The scanner checks itself on small samples ----

const SAMPLE_W1 = `
async function save() {
  // fetch("/x", { method: "POST" }) in a comment does not count
  const label = 'fetch("/y", { method: "DELETE" })';
  await fetch(\`/api/buyers?id=\${id}\`, { method: 'delete' });
  await window.fetch("/api/a", { headers: { a: "(" }, "method": \`Patch\` });
  await fetch("/api/b", { method: editing ? "PATCH" : "POST" });
  await fetch("/api/c", options);
  await fetch("/api/f", { ...defaults, body });
  const r = await fetch("/api/d", { method: "GET" });
  const s = await fetch("/api/e");
}`;

const SAMPLE_W2 = `
async function save() {
  await apiFetch("/api/a", { method: "POST" });
  let res = await apiFetch("/api/b", { method: "POST" });
  if (!res.ok) return;
}`;

const SAMPLE_W3 = `
async function save() {
  const res = await apiFetch("/api/a", { method: "POST" });
  toast.success("Saved"); // res.ok is only in this comment
  const label = "res.ok";
}
async function other() {
  const res = await apiFetch("/api/b", { method: "POST" });
  const data = await res.json();
  if (!res.ok) return;
}
async function twice() {
  const first = await apiFetch("/api/c", { method: "POST" });
  const second = await apiFetch("/api/d", { method: "POST" });
  if (!first.ok || !second.ok) return;
}`;

const SAMPLE_CLEAN = `
import { apiFetch, apiErrorMessage } from "@/lib/api-fetch";
const re = /fetch\\("x", \\{ method: "POST" \\}\\)/g;
export function Thing({ onDone }: { onDone: () => void }) {
  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(\`/api/leads/\${id}\`, {
        method: "PATCH",
        body: JSON.stringify({ ...extra, note: \`a } b \${x ? "}" : "{"}\` }),
      });
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, "Could not save the lead"));
        return;
      }
      const data = await res.json();
      onDone();
    } finally {
      setSaving(false);
    }
  };
  const list = await fetch("/api/leads").then((r) => r.json());
  return <Button onClick={save} disabled={a / b > 1}>Save {count} / {total}</Button>;
}`;

const SAMPLE_JSX_TEXT = `
export function Reminder({ count }: { count: number }) {
  return <div><p>Don't forget (really) {count}</p><button onClick={async () => { await fetch("/api/notes", { method: "POST" }); }}>Save</button></div>;
}`;

test("T26 the scanner reports a write sent with plain fetch() (rule W1) and nothing else", () => {
  const { findings } = scanSource(SAMPLE_W1);
  assert.deepEqual(
    findings.map((f) => `${f.rule} line ${f.line}`),
    ["W1 line 5", "W1 line 6", "W1 line 7", "W1 line 8", "W1 line 9"],
    JSON.stringify(findings)
  );
  assert.match(findings[0].detail, /DELETE/);
  assert.match(findings[1].detail, /PATCH/);
});

test("T26 the scanner reports an apiFetch() answer that is not kept in a const (rule W2)", () => {
  const { findings, apiFetchCalls } = scanSource(SAMPLE_W2);
  assert.equal(apiFetchCalls, 2);
  assert.deepEqual(findings.map((f) => `${f.rule} line ${f.line}`), ["W2 line 3", "W2 line 4"], JSON.stringify(findings));
});

test("T26 the scanner reports an apiFetch() answer that is not checked with .ok (rule W3)", () => {
  const { findings } = scanSource(SAMPLE_W3);
  assert.deepEqual(
    findings.map((f) => `${f.rule} line ${f.line}`),
    ["W3 line 3", "W3 line 8", "W3 line 13"],
    JSON.stringify(findings)
  );
  assert.match(findings[1].detail, /read before/);
});

test("T26 the scanner finds nothing wrong in a clean sample", () => {
  const { findings, apiFetchCalls } = scanSource(SAMPLE_CLEAN);
  assert.deepEqual(findings, []);
  assert.equal(apiFetchCalls, 1);
});

test("T26 an apostrophe and brackets in JSX text do not hide a write on the same line", () => {
  const { findings } = scanSource(SAMPLE_JSX_TEXT);
  assert.deepEqual(findings.map((f) => `${f.rule} line ${f.line} ${f.detail}`), ["W1 line 3 it sends POST"]);
});

test("T26 the scanner reports a file it cannot parse instead of passing it", () => {
  const { findings } = scanSource("function broken() {\n  const a = ;\n}");
  assert.deepEqual(findings.map((f) => `${f.rule} line ${f.line}`), ["READ line 2"], JSON.stringify(findings));
});

test("T26 a failure message names the file, the line and the rule, and says how to fix it", () => {
  const msg = failureMessage("W1", [explain("app/x/page.tsx", { rule: "W1", line: 12, detail: "it sends POST" })]);
  assert.match(msg, /\napp\/x\/page\.tsx line 12, rule W1: it sends POST$/);
  for (const rule of Object.keys(PLAIN)) assert.match(failureMessage(rule, []), /Fix: /, rule);
  assert.doesNotMatch(Object.values(PLAIN).join(" "), /[\u2013\u2014]/, "no em dashes or en dashes");
});

// ---- The real screens ----

const files = listSourceFiles(root, ["app", "components"], { skip: ["app/api"] });
const results = files.map((rel) => ({ rel, ...scanSource(readFileSync(path.join(root, rel), "utf8"), rel) }));

function report(rules) {
  const lines = [];
  for (const r of results) {
    for (const f of r.findings) if (rules.includes(f.rule)) lines.push(explain(r.rel, f));
  }
  return lines;
}

test("T26 the screen files were found and the parser reads every one of them without syntax errors", () => {
  assert.ok(files.length > 40, `found only ${files.length} files under app/ and components/`);
  const unread = report(["READ"]);
  assert.ok(unread.length === 0, failureMessage("READ", unread));
});

/** True when the file exports a function, const or let with this name. */
function exportsName(sf, name) {
  const isExported = (n) => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) !== 0;
  return sf.statements.some((s) => {
    if (ts.isFunctionDeclaration(s)) return s.name?.text === name && isExported(s);
    if (ts.isVariableStatement(s)) {
      return isExported(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name);
    }
    if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) {
      return s.exportClause.elements.some((e) => e.name.text === name);
    }
    return false;
  });
}

test("T26 lib/api-fetch.ts exists and exports apiFetch and apiErrorMessage", () => {
  assert.ok(
    existsSync(path.join(root, "lib", "api-fetch.ts")),
    "lib/api-fetch.ts is missing. Fix: add the shared helper that every screen uses to send writes and word their error messages."
  );
  const sf = parseRepoFile(root, "lib/api-fetch.ts");
  for (const name of ["apiFetch", "apiErrorMessage"]) {
    assert.ok(exportsName(sf, name), `lib/api-fetch.ts does not export ${name}. Fix: export it, the screens import it from there.`);
  }
});

test("T26 rule W1: no screen sends a save, change or delete with plain fetch()", () => {
  const lines = report(["W1"]);
  assert.ok(lines.length === 0, failureMessage("W1", lines));
});

test("T26 rule W2: every apiFetch() answer is kept as `const <name> = await apiFetch(`", () => {
  const lines = report(["W2"]);
  assert.ok(lines.length === 0, failureMessage("W2", lines));
});

test("T26 rule W3: every apiFetch() answer is tested with .ok before the screen moves on", () => {
  const lines = report(["W3"]);
  assert.ok(lines.length === 0, failureMessage("W3", lines));
});

test("T26 the scan sees more than 20 apiFetch() calls, so it cannot pass by scanning nothing", () => {
  const total = results.reduce((n, r) => n + r.apiFetchCalls, 0);
  assert.ok(
    total > 20,
    `found ${total} apiFetch() call(s) under app/ and components/; expected more than 20. Fix: send every save, change and delete through apiFetch().`
  );
});
