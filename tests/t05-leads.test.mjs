// T5. Lead updates ignore fields a user may not set, and never touch
// another user's lead.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

let ids;
beforeEach(async () => {
  ids = await reseed();
});
after(closeDb);

async function lead(id) {
  const [row] = await db()`SELECT * FROM leads WHERE id = ${id}`;
  return row;
}

test("T5 PATCH own lead with userId, id and createdAt: 200, only the name changes", async () => {
  const before = await lead(ids.aLead);
  const res = await api(`/api/leads/${ids.aLead}`, {
    method: "PATCH",
    user: USERS.A,
    body: { userId: USERS.B.id, user_id: USERS.B.id, id: 12345, createdAt: "2000-01-01T00:00:00.000Z", firstName: "Changed" },
  });
  assert.equal(res.status, 200, res.text);
  const after = await lead(ids.aLead);
  assert.ok(after, "the lead still has its id");
  assert.equal(after.first_name, "Changed");
  assert.equal(after.user_id, USERS.A.id);
  assert.equal(after.created_at, before.created_at);
  const [moved] = await db()`SELECT count(*)::int AS n FROM leads WHERE id = 12345`;
  assert.equal(moved.n, 0);
});

test("T5 PATCH own lead cannot set latitude, source or customData", async () => {
  const before = await lead(ids.aLead);
  const res = await api(`/api/leads/${ids.aLead}`, {
    method: "PATCH",
    user: USERS.A,
    body: { latitude: 1, longitude: 2, source: "evil", customData: "{}", lastName: "Renamed" },
  });
  assert.equal(res.status, 200, res.text);
  const after = await lead(ids.aLead);
  assert.equal(after.last_name, "Renamed");
  assert.equal(after.latitude, before.latitude);
  assert.equal(after.source, before.source);
  assert.equal(after.custom_data, before.custom_data);
});

test("T5 PATCH another user's lead leaves it unchanged", async () => {
  const before = await lead(ids.bLead);
  const res = await api(`/api/leads/${ids.bLead}`, {
    method: "PATCH",
    user: USERS.A,
    body: { firstName: "Hacked", status: "dead", userId: USERS.A.id },
  });
  assert.ok(res.status === 404 || res.status === 200, `${res.status}`);
  assert.deepEqual(await lead(ids.bLead), before);
});

test("T5 non-numeric and bad lead ids get 400 or 404, never 500", async () => {
  for (const path of ["/api/leads/abc", "/api/leads/-1", "/api/leads/1.5", "/api/leads/0", "/api/leads/99999999999999999999"]) {
    for (const method of ["GET", "PATCH"]) {
      const res = await api(path, { method, user: USERS.A, body: method === "PATCH" ? { firstName: "x" } : undefined });
      assert.ok(res.status === 400 || res.status === 404, `${method} ${path}: ${res.status} ${res.text.slice(0, 100)}`);
    }
  }
});

test("T5 a status outside the list is rejected and the lead is unchanged", async () => {
  const before = await lead(ids.aLead);
  const res = await api(`/api/leads/${ids.aLead}`, { method: "PATCH", user: USERS.A, body: { status: "x".repeat(500) } });
  assert.equal(res.status, 400);
  assert.deepEqual(await lead(ids.aLead), before);
  const ok = await api(`/api/leads/${ids.aLead}`, { method: "PATCH", user: USERS.A, body: { status: "contacted" } });
  assert.equal(ok.status, 200);
  assert.equal((await lead(ids.aLead)).status, "contacted");
});
