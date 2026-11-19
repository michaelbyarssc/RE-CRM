// T3. The sequence processor: a secret for all users, a session for your own
// steps only, nothing for anyone else.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

const SECRET = process.env.TEST_CRON_SECRET;
const NOCRON = process.env.TEST_NOCRON_URL;
let ids;
beforeEach(async () => {
  ids = await reseed();
});
after(closeDb);

async function enrollment(id) {
  const [row] = await db()`SELECT current_step, status, next_action_at FROM lead_sequences WHERE id = ${id}`;
  return row;
}
async function noteCount(leadId) {
  const [row] = await db()`SELECT count(*)::int AS n FROM notes WHERE lead_id = ${leadId} AND content LIKE '[SEQUENCE TASK%'`;
  return row.n;
}
async function assertUntouched(enrollmentId, leadId) {
  const e = await enrollment(enrollmentId);
  assert.equal(e.status, "active");
  assert.equal(e.current_step, 0);
  assert.equal(e.next_action_at, "2000-01-01T00:00:00.000Z");
  assert.equal(await noteCount(leadId), 0);
}
async function assertProcessed(enrollmentId, leadId) {
  const e = await enrollment(enrollmentId);
  assert.equal(e.status, "completed");
  assert.equal(await noteCount(leadId), 1);
}

test("T3 no session and no header: 401, nothing processed", async () => {
  const res = await api("/api/sequences/process", { method: "POST" });
  assert.equal(res.status, 401);
  await assertUntouched(ids.aEnrollment, ids.aLead);
  await assertUntouched(ids.bEnrollment, ids.bLead);
});

test("T3 wrong secret: 401, nothing processed (also when signed in)", async () => {
  for (const user of [undefined, USERS.A]) {
    const res = await api("/api/sequences/process", {
      method: "POST",
      user,
      headers: { authorization: `Bearer ${SECRET}x` },
    });
    assert.equal(res.status, 401, `user=${user?.email}`);
  }
  const res = await api("/api/sequences/process", { method: "POST", headers: { authorization: "Basic abc" } });
  assert.equal(res.status, 401);
  await assertUntouched(ids.aEnrollment, ids.aLead);
  await assertUntouched(ids.bEnrollment, ids.bLead);
});

test("T3 correct secret: 200 and every user's due steps are processed", async () => {
  const res = await api("/api/sequences/process", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.processed, 2);
  await assertProcessed(ids.aEnrollment, ids.aLead);
  await assertProcessed(ids.bEnrollment, ids.bLead);
});

test("T3 GET with the secret works (Vercel Cron), GET with only a session does not", async () => {
  const withSession = await api("/api/sequences/process", { user: USERS.A });
  assert.equal(withSession.status, 401);
  await assertUntouched(ids.aEnrollment, ids.aLead);
  const res = await api("/api/sequences/process", { headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 200, res.text);
  await assertProcessed(ids.bEnrollment, ids.bLead);
});

test("T3 signed in as A with no secret: only A's step is processed", async () => {
  const res = await api("/api/sequences/process", { method: "POST", user: USERS.A });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.processed, 1);
  await assertProcessed(ids.aEnrollment, ids.aLead);
  await assertUntouched(ids.bEnrollment, ids.bLead);
});

test("T3 a planted enrollment (A's sequence on B's lead) is never processed", async () => {
  const [planted] = await db()`
    INSERT INTO lead_sequences (lead_id, sequence_id, current_step, status, next_action_at)
    VALUES (${ids.bLead}, ${ids.aSeq}, 0, 'active', '2000-01-01T00:00:00.000Z') RETURNING id`;
  await api("/api/sequences/process", { method: "POST", user: USERS.A });
  await api("/api/sequences/process", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
  const e = await enrollment(planted.id);
  assert.equal(e.status, "active");
  assert.equal(e.current_step, 0);
  const [n] = await db()`SELECT count(*)::int AS n FROM notes WHERE lead_id = ${ids.bLead} AND content LIKE '%Alpha step%'`;
  assert.equal(n.n, 0);
});

test("T3 with CRON_SECRET unset the secret path is disabled", async () => {
  for (const value of [SECRET, "", "undefined", "null", "x".repeat(32)]) {
    const res = await api("/api/sequences/process", {
      method: "POST",
      base: NOCRON,
      headers: { authorization: `Bearer ${value}` },
    });
    assert.equal(res.status, 401, `bearer "${value.slice(0, 8)}": ${res.status}`);
  }
  await assertUntouched(ids.aEnrollment, ids.aLead);
  await assertUntouched(ids.bEnrollment, ids.bLead);
});
