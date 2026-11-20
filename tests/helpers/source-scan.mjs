// Reads the app's source files with the TypeScript parser, for tests that
// check how the screens are written (t27).
//
// The parser is the `typescript` package the repo already uses to build, so
// it reads every .ts and .tsx file exactly as the build does: strings,
// template literals, regular expressions, comments and JSX text are never
// mistaken for code.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export { ts };

/** Parses source text. .tsx files (and inline samples) are read as TSX. */
export function parseSource(fileName, text) {
  const kind = fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}

/**
 * The syntax errors the parser found, as "line N: message" strings.
 *
 * parseDiagnostics is not in TypeScript's public typings, so it is guarded
 * below. The public alternative, ts.transpileModule(text, { reportDiagnostics:
 * true, ... }), gave the same errors on all 74 files of app/, components/ and
 * lib/ (and "line 2" for the broken sample in t27), but took 0.6 to 1.6 s for
 * those files against 0.05 to 0.14 s here (measured 2026-11-20, typescript
 * 5.9.3), because it parses and prints each file again. So this keeps the
 * parser's own list.
 */
export function syntaxErrors(sourceFile) {
  const diagnostics = sourceFile.parseDiagnostics;
  if (!Array.isArray(diagnostics)) {
    throw new Error("this version of typescript does not expose parseDiagnostics; tests/helpers/source-scan.mjs needs updating");
  }
  return diagnostics.map((d) => {
    const line = d.start === undefined ? 1 : sourceFile.getLineAndCharacterOfPosition(d.start).line + 1;
    return `line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}

/** Calls visit(node) for every node of the tree, in source order. */
export function forEachNode(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => forEachNode(child, visit));
}

/** 1-based line where node starts (after leading comments and spaces). */
export function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * Every file under root/<dir> for each dir, whose name matches `pattern`,
 * skipping the folders in `skip` (paths relative to root, with forward
 * slashes) and node_modules. Returns paths relative to root, sorted.
 */
export function listSourceFiles(root, dirs, { pattern = /\.tsx?$/, skip = [] } = {}) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (statSync(full).isDirectory()) {
        if (name !== "node_modules" && !skip.includes(rel)) walk(full);
      } else if (pattern.test(name) && !name.endsWith(".d.ts")) {
        out.push(rel);
      }
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  return out.sort();
}

/** Reads and parses one file of the repo. */
export function parseRepoFile(root, rel) {
  return parseSource(rel, readFileSync(path.join(root, rel), "utf8"));
}
