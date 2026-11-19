// T14. Error hygiene: malformed JSON is a 400, and no response anywhere in the
// suite carries a stack trace. This file runs last so it sees every response.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, USERS } from "./helpers/db.mjs";

let ids;
before(async () => {
  ids = await reseed();
});
after(closeDb);

test("T14 malformed JSON bodies get 400", async () => {
  const targets = [
    ["POST", "/api/tags"],
    ["POST", "/api/leads"],
    ["PATCH", `/api/leads/${ids.aLead}`],
    ["POST", "/api/calendar"],
    ["POST", "/api/notes"],
    ["PATCH", `/api/sequences/${ids.aSeq}`],
    ["POST", "/api/settings"],
  ];
  for (const [method, path] of targets) {
    const res = await api(path, { method, user: USERS.A, body: "{not json" });
    assert.equal(res.status, 400, `${method} ${path}: ${res.status} ${res.text.slice(0, 120)}`);
    assert.equal(typeof res.json?.error, "string");
  }
});

test("T14 wrong body shapes get 400, never 500", async () => {
  const cases = [
    ["POST", "/api/tags", { name: 5 }],
    ["POST", "/api/buyers", {}],
    ["POST", "/api/notes", { leadId: "abc", content: "x" }],
    ["PATCH", "/api/leads", { action: "delete", ids: "not-an-array" }],
    ["POST", "/api/sequences/enroll", { leadIds: null, sequenceId: ids.aSeq }],
    ["POST", "/api/leads/import", { data: [null], mapping: {}, filename: "x.csv" }],
    ["PATCH", `/api/sequences/${ids.aSeq}`, { action: "updateStep", stepId: "abc", data: {} }],
    ["POST", "/api/admin/impersonate", { targetUserId: 5 }],
  ];
  for (const [method, path, body] of cases) {
    const res = await api(path, { method, user: USERS.A, body });
    assert.ok(res.status >= 400 && res.status < 500, `${method} ${path} ${JSON.stringify(body)}: ${res.status}`);
  }
});

function hasKey(value, key) {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((v) => hasKey(v, key));
}

test("T14 no response in the whole suite contains a stack field", () => {
  const lines = readFileSync(process.env.TEST_RESPONSE_LOG, "utf8").split("\n").filter(Boolean);
  assert.ok(lines.length > 100, `only ${lines.length} responses were logged`);
  const offenders = [];
  for (const line of lines) {
    const entry = JSON.parse(line);
    let body = null;
    try {
      body = JSON.parse(entry.body);
    } catch {
      // not JSON
    }
    if (hasKey(body, "stack") || /"stack"\s*:/.test(entry.body)) offenders.push(`${entry.method} ${entry.path}`);
  }
  assert.deepEqual(offenders, []);
});
