// T13. The lead list page size is capped (audit N10).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

before(async () => {
  await reseed();
  const rows = Array.from({ length: 250 }, (_, i) => ({
    user_id: USERS.A.id,
    property_address: `${i + 100} Bulk Rd`,
    status: "new",
  }));
  await db()`INSERT INTO leads ${db()(rows)}`;
});
after(closeDb);

test("T13 pageSize=100000 returns at most 200 leads and reports the capped size", async () => {
  const res = await api("/api/leads?pageSize=100000", { user: USERS.A });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.ok(res.json.leads.length <= 200, `${res.json.leads.length} leads`);
  assert.equal(res.json.pageSize, 200);
  assert.ok(res.json.total >= 250);
  assert.ok(res.json.leads.every((l) => Array.isArray(l.tags)));
});

test("T13 bad page values get 400, never 500", async () => {
  for (const q of ["page=0", "page=-1", "page=abc", "pageSize=0", "pageSize=-5", "pageSize=abc"]) {
    const res = await api(`/api/leads?${q}`, { user: USERS.A });
    assert.equal(res.status, 400, `${q}: ${res.status}`);
  }
});
