// T8. Tags (audit N4): another user's tag can never be linked or read back.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api, findMarkers } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

let ids;
beforeEach(async () => {
  ids = await reseed();
});
after(closeDb);

async function links(tagId) {
  const [r] = await db()`SELECT count(*)::int AS n FROM lead_tags WHERE tag_id = ${tagId}`;
  return r.n;
}

test("T8 addTag with B's tag id creates no link", async () => {
  const res = await api(`/api/leads/${ids.aLead}`, { method: "PATCH", user: USERS.A, body: { action: "addTag", tagId: ids.bTag } });
  assert.ok(res.status < 500, `${res.status}`);
  assert.equal(await links(ids.bTag), 0);
});

test("T8 bulk addTag with B's tag id creates no link", async () => {
  const res = await api("/api/leads", {
    method: "PATCH",
    user: USERS.A,
    body: { action: "addTag", ids: [ids.aLead, ids.aLead2], tagId: ids.bTag },
  });
  assert.ok(res.status < 500, `${res.status}`);
  assert.equal(await links(ids.bTag), 0);
});

test("T8 own tags still link (single and bulk)", async () => {
  const one = await api(`/api/leads/${ids.aLead}`, { method: "PATCH", user: USERS.A, body: { action: "addTag", tagId: ids.aTag } });
  assert.equal(one.status, 200, one.text);
  const bulk = await api("/api/leads", { method: "PATCH", user: USERS.A, body: { action: "addTag", ids: [ids.aLead, ids.aLead2], tagId: ids.aTag } });
  assert.equal(bulk.status, 200, bulk.text);
  assert.equal(await links(ids.aTag), 2);
  const lead = await api(`/api/leads/${ids.aLead}`, { user: USERS.A });
  assert.deepEqual(lead.json.tags.map((t) => t.id), [ids.aTag]);
});

test("T8 an old bad link does not return B's tag", async () => {
  await db()`INSERT INTO lead_tags (lead_id, tag_id) VALUES (${ids.aLead}, ${ids.bTag})`;
  for (const path of ["/api/leads", `/api/leads/${ids.aLead}`]) {
    const res = await api(path, { user: USERS.A });
    assert.equal(res.status, 200);
    assert.deepEqual(findMarkers(res.text, ["ZZVICTIMTAG"]), [], `${path} returns B's tag`);
  }
});
