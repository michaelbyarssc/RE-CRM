#!/usr/bin/env node
// Puts two capture runs side by side and says what changed.
//
//   node tests/layout-check/compare.mjs <before> <after> [--out <file>] [--expect-same]
//   node tests/layout-check/compare.mjs before after
//
// <before> and <after> are run labels (the tool reads
// out/reports/detector-<label>.json) or paths to such JSON files.
// It writes out/reports/compare-<before>-vs-<after>.md and prints the short
// result. Every number comes from the two JSON files; nothing is measured here.
//
// --expect-same   exit with status 1 when the two runs differ in any way. Use
//                 it to check the tool itself: two runs of the same build on
//                 the same data must give the same result.

import fs from "node:fs";
import path from "node:path";
import { outPath, parseArgs } from "./lib.mjs";
import { countsFor, itemsFor, summaryRows, widthsOf } from "./report-rows.mjs";

const USAGE = `Usage: node tests/layout-check/compare.mjs <before> <after> [--out <file>] [--expect-same]
<before> and <after> are run labels (for example: before after) or paths to detector JSON files.`;

function load(nameOrPath) {
  const looksLikePath = nameOrPath.includes("/") || nameOrPath.includes(path.sep) || nameOrPath.endsWith(".json");
  const file = looksLikePath ? path.resolve(nameOrPath) : path.join(outPath("reports"), `detector-${nameOrPath}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`There is no report ${file}. Run the capture for it first (a failed capture writes no report).`);
  }
  let rep;
  try {
    rep = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} is not a JSON file.`);
  }
  if (!rep || typeof rep.results !== "object" || !Array.isArray(rep.widths)) {
    throw new Error(`${file} is not a report written by capture.mjs.`);
  }
  return { rep, file, label: String(rep.label || path.basename(file, ".json")).replace(/[^a-z0-9_-]/gi, "-") };
}

function describe(side) {
  const { rep, file } = side;
  const opt = rep.options || {};
  const extras = [
    opt.weight ? `base text weight ${opt.weight}` : null,
    opt.views ? `only the views ${opt.views.join(", ")}` : null,
  ].filter(Boolean);
  return `"${rep.label}": ${rep.baseUrl}, run ${rep.started}${extras.length ? `, ${extras.join(", ")}` : ""} (${file})`;
}

// The items of `a` that are not in `b`. An item that is there twice counts twice.
function minus(a, b) {
  const left = new Map();
  for (const x of b) left.set(x, (left.get(x) || 0) + 1);
  const out = [];
  for (const x of a) {
    const n = left.get(x) || 0;
    if (n > 0) left.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

function compare(before, after) {
  const wb = widthsOf(before.rep);
  const wa = widthsOf(after.rep);
  const main = [...wa.main, ...wb.main.filter((w) => !wa.main.includes(w))];
  const extra = [...wa.extra, ...wb.extra.filter((w) => !wa.extra.includes(w))].filter((w) => !main.includes(w));
  const widths = [...main, ...extra];

  const counts = widths.map((w) => ({ w, before: countsFor(before.rep, w), after: countsFor(after.rep, w) }));

  const added = [];
  const gone = [];
  const kept = [];
  for (const w of widths) {
    const b = itemsFor(before.rep, w);
    const a = itemsFor(after.rep, w);
    for (const x of minus(a, b)) added.push(`${w}: ${x}`);
    for (const x of minus(b, a)) gone.push(`${w}: ${x}`);
    for (const x of minus(a, minus(a, b))) kept.push(`${w}: ${x}`);
  }

  const rowsBefore = new Map(summaryRows(before.rep).map((r) => [r.name, r.cells]));
  const rowsAfter = new Map(summaryRows(after.rep).map((r) => [r.name, r.cells]));
  const names = [...rowsAfter.keys(), ...[...rowsBefore.keys()].filter((n) => !rowsAfter.has(n))];
  const changed = [];
  const same = [];
  for (const name of names) {
    for (const w of widths) {
      const b = rowsBefore.get(name)?.[w] ?? "n/a";
      const a = rowsAfter.get(name)?.[w] ?? "n/a";
      if (b === "n/a" && a === "n/a") continue;
      (a === b ? same : changed).push({ name, w, before: b, after: a });
    }
  }
  return { widths, main, extra, counts, added, gone, kept, changed, same };
}

const list = (items, none) => (items.length ? items.map((x) => `- ${x}`).join("\n") : none);
const cellsTable = (cells) =>
  `| Check | Width | Before | After |\n| --- | --- | --- | --- |\n` +
  cells.map((c) => `| ${c.name} | ${c.w} | ${c.before} | ${c.after} |`).join("\n");

function notes(side, name) {
  const rep = side.rep;
  const blocked = rep.blockedWrites || [];
  const faked = rep.fakedWrites || [];
  const warnings = rep.warnings || [];
  let md = `- ${name}: ${blocked.length} blocked write call(s), ${faked.length} write call(s) answered in the browser, ${warnings.length} warning(s).`;
  if (warnings.length) md += `\n${warnings.map((x) => `  - ${x}`).join("\n")}`;
  return md;
}

function markdown(before, after, c) {
  const identical = !c.added.length && !c.gone.length && !c.changed.length;
  let md = `# Layout check: "${before.rep.label}" compared with "${after.rep.label}"\n\n`;
  md += `- Before: ${describe(before)}\n- After: ${describe(after)}\n\n`;
  md += `Made by \`tests/layout-check/compare.mjs\`. Every number comes from the two JSON files. `;
  md += `"n/a" means that the check did not run at that width in that run. `;
  md += `The extra widths (${c.extra.join(", ") || "none"}) only run some views, so compare their counts only with each other.\n\n`;

  md += `## Result\n\n`;
  if (identical) {
    md += `No difference. Every check gives the same answer in both runs, and the same things are clipped, scroll sideways, spill or end on a lone word.\n\n`;
  } else {
    md += `- New in after (not in before): ${c.added.length}\n`;
    md += `- Gone in after (was in before): ${c.gone.length}\n`;
    md += `- In both: ${c.kept.length}\n`;
    md += `- Checks that give another answer: ${c.changed.length} of ${c.changed.length + c.same.length}\n\n`;
  }

  md += `## 1. Counts per width (in view, all views). Each cell is before / after.\n\n`;
  md += `| Width | Clipped text | Sideways scroll | Spills out of its box | Lone last words |\n| --- | --- | --- | --- | --- |\n`;
  for (const { w, before: b, after: a } of c.counts) {
    md += `| ${w} | ${b.clipped} / ${a.clipped} | ${b.sideways} / ${a.sideways} | ${b.spills} / ${a.spills} | ${b.loneWords} / ${a.loneWords} |\n`;
  }

  md += `\n## 2. New in after\n\nThese are in view in "${after.rep.label}" and not in "${before.rep.label}". Each one needs a look.\n\n`;
  md += `${list(c.added, "Nothing.")}\n`;
  md += `\n## 3. Gone in after\n\n${list(c.gone, "Nothing.")}\n`;
  md += `\n## 4. In both\n\nNot new. Decide for each one whether it is meant (a board that scrolls sideways is) or still to fix.\n\n`;
  md += `${list(c.kept, "Nothing.")}\n`;
  md += `\n## 5. Checks that give another answer\n\n${c.changed.length ? cellsTable(c.changed) : "None."}\n`;
  md += `\n## 6. Checks that give the same answer\n\n${c.same.length ? cellsTable(c.same) : "None."}\n`;
  md += `\n## 7. Run notes\n\n${notes(before, "Before")}\n${notes(after, "After")}\n`;
  return md;
}

function main() {
  const { options, rest } = parseArgs(process.argv.slice(2), { values: ["out"], flags: ["expect-same"] });
  if (rest.length !== 2) throw new Error("Give two runs to compare.");
  const before = load(rest[0]);
  const after = load(rest[1]);
  const c = compare(before, after);
  const identical = !c.added.length && !c.gone.length && !c.changed.length;
  const outFile = options.out
    ? path.resolve(options.out)
    : path.join(outPath("reports"), `compare-${before.label}-vs-${after.label}.md`);
  fs.writeFileSync(outFile, markdown(before, after, c));

  console.log(`Before: ${describe(before)}`);
  console.log(`After:  ${describe(after)}`);
  console.log("\nIn view, all views (before / after): width | clipped | sideways scroll | spills | lone last words");
  for (const { w, before: b, after: a } of c.counts) {
    console.log(
      `  ${String(w).padStart(4)} | ${b.clipped} / ${a.clipped} | ${b.sideways} / ${a.sideways} | ${b.spills} / ${a.spills} | ${b.loneWords} / ${a.loneWords}`
    );
  }
  console.log(
    `\nNew in after: ${c.added.length}. Gone in after: ${c.gone.length}. In both: ${c.kept.length}. ` +
      `Checks that give another answer: ${c.changed.length} of ${c.changed.length + c.same.length}.`
  );
  for (const x of c.added) console.log(`  new: ${x}`);
  console.log(identical ? "No difference between the two runs." : "The two runs differ.");
  const warnings = (before.rep.warnings || []).length + (after.rep.warnings || []).length;
  if (warnings)
    console.log(`Careful: the runs have ${warnings} warning(s), so something was not measured. See section 7.`);
  console.log(`Wrote ${outFile}`);
  return options["expect-same"] && !identical ? 1 : 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(err.message);
  console.error(USAGE);
  process.exit(1);
}
