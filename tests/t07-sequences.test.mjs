// T7. Sequence and step writes take only allowed fields; the sequence id
// always comes from the checked value (audit N1, N2, N3).

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

let ids;
beforeEach(async () => {
  ids = await reseed();
});
after(closeDb);

async function stepCount(seqId) {
  const [r] = await db()`SELECT count(*)::int AS n FROM sequence_steps WHERE sequence_id = ${seqId}`;
  return r.n;
}

test("T7 addStep with step.sequenceId set to B's sequence adds nothing to B", async () => {
  const before = await stepCount(ids.bSeq);
  const res = await api(`/api/sequences/${ids.aSeq}`, {
    method: "PATCH",
    user: USERS.A,
    body: {
      action: "addStep",
      step: { sequenceId: ids.bSeq, id: 999999, stepOrder: 2, delayDays: 0, actionType: "call", template: "injected" },
    },
  });
  assert.ok(res.status < 500, `${res.status} ${res.text.slice(0, 200)}`);
  assert.equal(await stepCount(ids.bSeq), before);
  const [r] = await db()`SELECT count(*)::int AS n FROM sequence_steps WHERE template = 'injected' AND sequence_id <> ${ids.aSeq}`;
  assert.equal(r.n, 0);
});

test("T7 addStep on own sequence still works", async () => {
  const before = await stepCount(ids.aSeq);
  const res = await api(`/api/sequences/${ids.aSeq}`, {
    method: "PATCH",
    user: USERS.A,
    body: { action: "addStep", step: { stepOrder: 2, delayDays: 1, actionType: "email", template: "hi" } },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(await stepCount(ids.aSeq), before + 1);
});

test("T7 updateStep with data.sequenceId set to B's sequence keeps the step in A's sequence", async () => {
  const res = await api(`/api/sequences/${ids.aSeq}`, {
    method: "PATCH",
    user: USERS.A,
    body: { action: "updateStep", stepId: ids.aStep, data: { sequenceId: ids.bSeq, id: 999999, template: "moved" } },
  });
  assert.ok(res.status < 500, `${res.status}`);
  const [row] = await db()`SELECT id, sequence_id FROM sequence_steps WHERE id = ${ids.aStep}`;
  assert.ok(row, "step keeps its id");
  assert.equal(row.sequence_id, ids.aSeq);
});

test("T7 updateStep on B's step changes nothing", async () => {
  const [before] = await db()`SELECT * FROM sequence_steps WHERE id = ${ids.bStep}`;
  await api(`/api/sequences/${ids.aSeq}`, {
    method: "PATCH",
    user: USERS.A,
    body: { action: "updateStep", stepId: ids.bStep, data: { template: "hijack" } },
  });
  const [after] = await db()`SELECT * FROM sequence_steps WHERE id = ${ids.bStep}`;
  assert.deepEqual(after, before);
});

test("T7 PATCH own sequence with userId set to B keeps it A's", async () => {
  const res = await api(`/api/sequences/${ids.aSeq}`, {
    method: "PATCH",
    user: USERS.A,
    body: { userId: USERS.B.id, user_id: USERS.B.id, id: 999999, name: "Renamed seq" },
  });
  assert.equal(res.status, 200, res.text);
  const [row] = await db()`SELECT user_id, name FROM sequences WHERE id = ${ids.aSeq}`;
  assert.equal(row.user_id, USERS.A.id);
  assert.equal(row.name, "Renamed seq");
});

test("T7 bad sequence ids get 400 or 404, never 500", async () => {
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const res = await api("/api/sequences/abc", { method, user: USERS.A, body: method === "PATCH" ? { name: "x" } : undefined });
    assert.ok(res.status === 400 || res.status === 404, `${method}: ${res.status}`);
  }
});
