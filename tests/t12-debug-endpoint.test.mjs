// T12. The Google "debug" answer is admin only and never shows the client id
// or the auth URL (audit N8).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, USERS } from "./helpers/db.mjs";

before(reseed);
after(closeDb);

test("T12 action=debug as a user: 403 without the client id", async () => {
  const res = await api("/api/calendar/google?action=debug", { user: USERS.A });
  assert.equal(res.status, 403, `${res.status} ${res.text.slice(0, 200)}`);
  assert.ok(!res.text.includes("test-client-id"));
});

test("T12 action=debug as an admin: no client id and no auth URL", async () => {
  const res = await api("/api/calendar/google?action=debug", { user: USERS.ADMIN });
  assert.equal(res.status, 200, res.text);
  assert.ok(!res.text.includes("test-client-id"), "client id not shown");
  assert.ok(!res.text.includes("accounts.google.com"), "auth URL not shown");
});
