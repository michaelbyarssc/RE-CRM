// T2. No road to admin. A signed-in user sends hostile bodies to every
// state-changing route; afterwards nobody's role or ownership has changed and
// every new row belongs to the caller.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { discoverRoutes } from "./helpers/routes.mjs";
import { reseed, closeDb, db, USERS, ownershipSnapshot } from "./helpers/db.mjs";

let ids;
before(async () => {
  ids = await reseed();
});
after(closeDb);

const A = USERS.A;

function hostile() {
  return { role: "admin", userId: USERS.B.id, user_id: USERS.B.id, id: 999999 };
}

// Minimal valid request for every state-changing route. A route that is not
// listed here makes the test fail, so new routes cannot be skipped.
function sweepPlan(ids) {
  return {
    "POST /api/leads/geocode": { path: "/api/leads/geocode", body: {} },
    "POST /api/admin/impersonate": { path: "/api/admin/impersonate", body: { targetUserId: USERS.B.id }, expect: 403 },
    "DELETE /api/admin/impersonate": { path: "/api/admin/impersonate", expect: 403 },
    "POST /api/buyers": { path: "/api/buyers", body: { name: "Sweep buyer" } },
    "DELETE /api/buyers": { path: `/api/buyers?id=${ids.aBuyerSpare}` },
    "POST /api/buyers/zones": { path: "/api/buyers/zones", body: { buyerId: ids.aBuyer } },
    "PATCH /api/calendar/[id]": { path: `/api/calendar/${ids.aEvent}`, body: { title: "Sweep event" } },
    "DELETE /api/calendar/[id]": { path: `/api/calendar/${ids.aEventSpare}` },
    "DELETE /api/calendar/google": { path: "/api/calendar/google" },
    "POST /api/calendar/google/sync": { path: "/api/calendar/google/sync", body: {} },
    "POST /api/calendar": {
      path: "/api/calendar",
      body: { title: "Sweep new event", startAt: "2030-01-01T10:00:00", eventType: "custom" },
    },
    "POST /api/calls": { path: "/api/calls", body: { leadId: ids.aLead, notes: "sweep call" } },
    "PATCH /api/leads/[id]": { path: `/api/leads/${ids.aLead}`, body: { firstName: "Sweep" } },
    "POST /api/leads/import": {
      path: "/api/leads/import",
      body: { data: [{ Address: "1 Sweep Import St" }], mapping: { Address: "propertyAddress" }, filename: "sweep.csv" },
    },
    "PATCH /api/leads": { path: "/api/leads", body: { action: "updateStatus", ids: [ids.aLead2], status: "contacted" } },
    "POST /api/leads": { path: "/api/leads", body: { propertyAddress: "2 Sweep St" } },
    "POST /api/notes": { path: "/api/notes", body: { leadId: ids.aLead, content: "sweep note" } },
    "DELETE /api/notes": { path: `/api/notes?id=${ids.aNoteSpare}` },
    "PATCH /api/sequences/[id]": { path: `/api/sequences/${ids.aSeq}`, body: { name: "Sweep seq" } },
    "DELETE /api/sequences/[id]": { path: `/api/sequences/${ids.aSeqSpare}` },
    "POST /api/sequences/enroll": { path: "/api/sequences/enroll", body: { leadIds: [ids.aLead2], sequenceId: ids.aSeq } },
    "POST /api/sequences/process": { path: "/api/sequences/process", body: {} },
    "POST /api/sequences": { path: "/api/sequences", body: { name: "Sweep sequence" } },
    "POST /api/settings": { path: "/api/settings", body: { sweep_setting: "on" } },
    "POST /api/tags": { path: "/api/tags", body: { name: "Sweep tag" } },
  };
}

test("T2 POST /api/migrate does not exist (404)", async () => {
  const res = await api("/api/migrate", { method: "POST", user: A });
  assert.equal(res.status, 404, `got ${res.status} ${res.text.slice(0, 200)}`);
  const [row] = await db()`SELECT role FROM user_profiles WHERE id = ${A.id}`;
  assert.equal(row.role, "user");
});

test("T2 hostile bodies on every state-changing route change no role and no owner", async () => {
  const before = await ownershipSnapshot();
  const plan = sweepPlan(ids);
  const keys = [];
  for (const r of discoverRoutes()) {
    if (r.template === "/api/migrate") continue; // covered by the 404 test above
    for (const m of r.methods) if (m !== "GET" && m !== "HEAD") keys.push(`${m} ${r.template}`);
  }
  const missing = keys.filter((k) => !plan[k]);
  assert.deepEqual(missing, [], "every state-changing route needs a sweep entry");

  // Geocode first, so it never has new ungeocoded leads to look up.
  const ordered = Object.keys(plan).filter((k) => keys.includes(k));
  for (const key of ordered) {
    const [method] = key.split(" ");
    const entry = plan[key];
    const body = { ...(entry.body || {}), ...hostile() };
    const res = await api(entry.path, { method, user: A, body });
    assert.ok(res.status < 500, `${key}: server error ${res.status} ${res.text.slice(0, 200)}`);
    if (entry.expect) assert.equal(res.status, entry.expect, `${key}: ${res.text.slice(0, 200)}`);
  }

  const me = await api("/api/auth/me", { user: A });
  assert.equal(me.status, 200);
  assert.equal(me.json.role, "user");
  assert.equal(me.json.effectiveId, A.id);
  const [row] = await db()`SELECT role FROM user_profiles WHERE id = ${A.id}`;
  assert.equal(row.role, "user");
  const admins = await db()`SELECT id FROM user_profiles WHERE role = 'admin'`;
  assert.deepEqual(admins.map((r) => r.id), [USERS.ADMIN.id]);

  const afterSnap = await ownershipSnapshot();
  const problems = [];
  for (const [table, rows] of Object.entries(afterSnap)) {
    for (const [id, owner] of rows) {
      const old = before[table]?.get(id);
      if (old !== undefined && old !== owner) problems.push(`${table} #${id}: owner ${old} -> ${owner}`);
      if (old === undefined && owner !== A.id) problems.push(`${table} #${id}: new row owned by ${owner}`);
      if (id === 999999) problems.push(`${table}: a row got the client-chosen id 999999`);
    }
  }
  assert.deepEqual(problems, []);
});

test("T2 a user cannot start impersonating", async () => {
  const res = await api("/api/admin/impersonate", { method: "POST", user: A, body: { targetUserId: USERS.B.id } });
  assert.equal(res.status, 403);
  const list = await api("/api/admin/impersonate", { user: A });
  assert.equal(list.status, 403);
});

test("T2 a brand new signed-in user gets role user", async () => {
  const fresh = { id: "dddddddd-0000-4000-8000-00000000000d", email: "fresh@example.com" };
  const res = await api("/api/auth/me", { user: fresh });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.role, "user");
  const [row] = await db()`SELECT role FROM user_profiles WHERE id = ${fresh.id}`;
  assert.equal(row.role, "user");
});

test("T2 two parallel first requests from a new user both succeed", async () => {
  const fresh = { id: "eeeeeeee-0000-4000-8000-00000000000e", email: "parallel@example.com" };
  const results = await Promise.all([1, 2, 3, 4].map(() => api("/api/auth/me", { user: fresh })));
  for (const r of results) assert.equal(r.status, 200, r.text);
  const rows = await db()`SELECT role FROM user_profiles WHERE id = ${fresh.id}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, "user");
});
