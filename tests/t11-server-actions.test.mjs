// T11. Guard: the build exposes no server actions (audit N24). The helper
// files are server-only modules, not "use server" files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.env.TEST_REPO_ROOT;

test("T11 the server reference manifest lists no server actions", () => {
  const file = path.join(root, ".next", "server", "server-reference-manifest.json");
  assert.ok(existsSync(file), "manifest exists after the build");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const actions = { ...(manifest.node || {}), ...(manifest.edge || {}) };
  const listed = Object.entries(actions).map(([id, entry]) => {
    const where = Object.keys(entry.workers || {}).join(", ");
    return `${id.slice(0, 12)} ${entry.exportedName || ""} (${where})`;
  });
  console.log(`server-reference-manifest.json lists ${listed.length} action(s)${listed.length ? ":\n  " + listed.join("\n  ") : ""}`);
  assert.deepEqual(listed, []);
});

test("T11 no lib/actions file starts with \"use server\"", () => {
  const dir = path.join(root, "lib", "actions");
  for (const f of readdirSync(dir)) {
    const text = readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/^\s*["']use server["']/.test(text), `${f} is a "use server" file`);
  }
});
