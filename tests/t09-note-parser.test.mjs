// T9. The note parser cannot be used to freeze the server (audit N5), and
// note length is capped.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { api, waitForApp } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

let ids;
before(async () => {
  ids = await reseed();
});
after(closeDb);

test("T9 a note built to trigger regex backtracking finishes in under 2 seconds", async () => {
  // "tomorrow" keeps the parser going to the address step at any time of day
  // ("today at 1" is skipped as a past time after 2 AM).
  const content = "tomorrow at 1" + " ".repeat(5000) + "!";
  let res;
  let error;
  try {
    res = await api("/api/notes", {
      method: "POST",
      user: USERS.A,
      body: { leadId: ids.aLead, content },
      timeoutMs: 10_000,
    });
  } catch (err) {
    error = err;
  }
  if (error || res.ms >= 2000) {
    // Let the server recover before the next test file runs.
    await waitForApp();
  }
  assert.ok(!error, `request did not finish: ${error?.name}`);
  assert.ok(res.ms < 2000, `took ${res.ms} ms`);
  assert.equal(res.status, 200, res.text.slice(0, 200));
});

test("T9 a note over 10,000 characters gets a 400 and is not stored", async () => {
  const [before] = await db()`SELECT count(*)::int AS n FROM notes`;
  const res = await api("/api/notes", {
    method: "POST",
    user: USERS.A,
    body: { leadId: ids.aLead, content: "x".repeat(10_001) },
  });
  assert.equal(res.status, 400, `${res.status}`);
  const [after] = await db()`SELECT count(*)::int AS n FROM notes`;
  assert.equal(after.n, before.n);
});

test("T9 ordinary notes still create calendar events with an address", async () => {
  const res = await api("/api/notes", {
    method: "POST",
    user: USERS.A,
    body: {
      leadId: ids.aLead,
      content: "Meet seller tomorrow at 3pm at 123 Main St",
      localNow: "2030-05-01T09:00:00",
    },
  });
  assert.equal(res.status, 200, res.text);
  assert.ok(res.json.calendarEvent, "an event was created");
  const [ev] = await db()`SELECT location, event_type FROM calendar_events WHERE id = ${res.json.calendarEvent.id}`;
  assert.equal(ev.location, "123 Main St");
  assert.equal(ev.event_type, "appointment");
});

test("T9 a note on another user's lead gets 404", async () => {
  const res = await api("/api/notes", { method: "POST", user: USERS.A, body: { leadId: ids.bLead, content: "hi" } });
  assert.equal(res.status, 404, `${res.status}`);
});
