// T6. Calendar events cannot point at another user's lead or buyer, and an
// old bad link never shows the other user's details.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api, findMarkers } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS, VICTIM_MARKERS } from "./helpers/db.mjs";

let ids;
beforeEach(async () => {
  ids = await reseed();
});
after(closeDb);

async function eventCount() {
  const [r] = await db()`SELECT count(*)::int AS n FROM calendar_events`;
  return r.n;
}
const base = { title: "Probe", startAt: "2030-01-01T10:00:00", eventType: "custom" };

test("T6 create an event with B's leadId: 4xx and nothing is created", async () => {
  const n = await eventCount();
  const res = await api("/api/calendar", { method: "POST", user: USERS.A, body: { ...base, leadId: ids.bLead } });
  assert.ok(res.status >= 400 && res.status < 500, `${res.status} ${res.text.slice(0, 200)}`);
  assert.equal(await eventCount(), n);
  assert.deepEqual(findMarkers(res.text, VICTIM_MARKERS), []);
});

test("T6 create an event with B's buyerId: 4xx and nothing is created", async () => {
  const n = await eventCount();
  const res = await api("/api/calendar", { method: "POST", user: USERS.A, body: { ...base, buyerId: ids.bBuyer } });
  assert.ok(res.status >= 400 && res.status < 500, `${res.status} ${res.text.slice(0, 200)}`);
  assert.equal(await eventCount(), n);
});

test("T6 create an event with own lead and buyer works", async () => {
  const res = await api("/api/calendar", {
    method: "POST",
    user: USERS.A,
    body: { ...base, leadId: ids.aLead, buyerId: ids.aBuyer },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.leadId, ids.aLead);
});

test("T6 update own event to B's leadId or buyerId: 4xx and unchanged", async () => {
  for (const body of [{ leadId: ids.bLead }, { buyerId: ids.bBuyer }]) {
    const res = await api(`/api/calendar/${ids.aEvent}`, { method: "PATCH", user: USERS.A, body });
    assert.ok(res.status >= 400 && res.status < 500, `${JSON.stringify(body)}: ${res.status}`);
  }
  const [row] = await db()`SELECT lead_id, buyer_id FROM calendar_events WHERE id = ${ids.aEvent}`;
  assert.equal(row.lead_id, null);
  assert.equal(row.buyer_id, null);
});

test("T6 an old bad link never shows B's lead or buyer details", async () => {
  const start = ids.futureLocal(1);
  const [planted] = await db()`
    INSERT INTO calendar_events (user_id, title, event_type, start_at, status, lead_id, buyer_id)
    VALUES (${USERS.A.id}, 'Planted link', 'custom', ${start}, 'scheduled', ${ids.bLead}, ${ids.bBuyer})
    RETURNING id`;
  const s = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const e = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const checks = [
    `/api/calendar?start=${s}&end=${e}`,
    `/api/calendar/${planted.id}`,
    "/api/calendar/search",
    "/api/calendar/search?type=buyers",
    "/api/calendar/search?q=ZZ",
    "/",
  ];
  for (const path of checks) {
    const res = await api(path, { user: USERS.A });
    assert.equal(res.status, 200, `${path}: ${res.status}`);
    assert.deepEqual(findMarkers(res.text, VICTIM_MARKERS), [], `${path} leaks B's data`);
  }
  // The event itself is still listed (the owner sees their own event).
  const list = await api(`/api/calendar?start=${s}&end=${e}`, { user: USERS.A });
  assert.ok(list.json.some((ev) => ev.id === planted.id));
});

test("T6 a PATCH cannot set googleEventId or syncStatus", async () => {
  await db()`UPDATE calendar_events SET google_event_id = 'orig-id', sync_status = 'synced' WHERE id = ${ids.aEvent}`;
  const res = await api(`/api/calendar/${ids.aEvent}`, {
    method: "PATCH",
    user: USERS.A,
    body: { googleEventId: "../../evil?x=1", syncStatus: "hacked", title: "Renamed" },
  });
  assert.equal(res.status, 200, res.text);
  const [row] = await db()`SELECT title, google_event_id, sync_status FROM calendar_events WHERE id = ${ids.aEvent}`;
  assert.equal(row.title, "Renamed");
  assert.equal(row.google_event_id, "orig-id");
  assert.equal(row.sync_status, "synced");
});

test("T6 bad event ids get 400 or 404, never 500", async () => {
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const res = await api("/api/calendar/abc", { method, user: USERS.A, body: method === "PATCH" ? { title: "x" } : undefined });
    assert.ok(res.status === 400 || res.status === 404, `${method}: ${res.status}`);
  }
});
