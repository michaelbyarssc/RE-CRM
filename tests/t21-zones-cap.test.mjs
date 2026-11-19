// T21. One buyer zones request geocodes at most 25 areas
// (review finding F-DOS-ZONES). Outbound calls are blocked and logged by the
// harness, so the test counts the lookup attempts.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

const NETWORK_LOG = process.env.TEST_NETWORK_LOG;
const A = USERS.A;
let ids;

beforeEach(async () => {
  ids = await reseed();
  writeFileSync(NETWORK_LOG, "");
});
after(closeDb);

function geocoderCalls() {
  return readFileSync(NETWORK_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => new URL(c.url).hostname === "nominatim.openstreetmap.org")
    .map((c) => new URL(c.url).searchParams.get("q"));
}
async function setAreas(areas) {
  await db()`UPDATE buyers SET buy_criteria = ${JSON.stringify({ areas })} WHERE id = ${ids.aBuyer}`;
}

test("T21 a buyer with 200 areas makes at most 25 lookups, answers in bounded time and reports what was left out", async () => {
  await setAreas(Array.from({ length: 200 }, (_, i) => `Town${i}`).join(", "));
  const res = await api("/api/buyers/zones", {
    method: "POST",
    user: A,
    body: { buyerId: ids.aBuyer },
    timeoutMs: 60_000,
  });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.ok(res.ms < 40_000, `took ${res.ms} ms`);
  const calls = geocoderCalls();
  assert.ok(calls.length >= 1 && calls.length <= 25, `${calls.length} lookup attempts`);
  assert.equal(res.json.total, 200);
  assert.equal(res.json.skipped, 175, JSON.stringify(res.json));
});

test("T21 areas are trimmed and de-duplicated before the lookups", async () => {
  await setAreas(" Spartanburg ,spartanburg,, Greenville,SPARTANBURG ,  greenville  ");
  const res = await api("/api/buyers/zones", { method: "POST", user: A, body: { buyerId: ids.aBuyer } });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.deepEqual(geocoderCalls(), ["Spartanburg, USA", "Greenville, USA"]);
  assert.equal(res.json.total, 2);
  assert.equal(res.json.skipped, 0);
});

test("T21 an ordinary buyer still gets every area looked up", async () => {
  await setAreas("29301, Spartanburg County, Greer");
  const res = await api("/api/buyers/zones", { method: "POST", user: A, body: { buyerId: ids.aBuyer } });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.deepEqual(geocoderCalls(), ["29301, USA", "Spartanburg County, USA", "Greer, USA"]);
  // The geocoder is unreachable in tests, so nothing is found, but every area was tried.
  assert.equal(res.json.geocoded, 0);
  assert.equal(res.json.total, 3);
  assert.equal(res.json.skipped, 0);
});
