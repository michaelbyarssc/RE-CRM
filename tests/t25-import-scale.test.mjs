// T25. A CSV import cannot stall the app (review finding F-DOS-IMPORT):
// one duplicate check for the whole file, inserts in batches, at most 25,000
// rows per request. The counts and the csv_imports record stay as before,
// including the quirks of the duplicate rule (the incoming address is lower
// cased with white space collapsed; the stored one is compared as
// lower(replace(property_address, '  ', ' '))).

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

const A = USERS.A;
const B = USERS.B;
const MAPPING = {
  "Property Address": "propertyAddress",
  "Owner First": "firstName",
  City: "propertyCity",
  "Owner Age": "skip",
};

beforeEach(reseed);
after(closeDb);

async function leadCount(user) {
  const [{ n }] = await db()`SELECT count(*)::int AS n FROM leads WHERE user_id = ${user.id}`;
  return n;
}
async function importCount(user) {
  const [{ n }] = await db()`SELECT count(*)::int AS n FROM csv_imports WHERE user_id = ${user.id}`;
  return n;
}
function bigFile(n, tag) {
  return Array.from({ length: n }, (_, i) => ({
    "Property Address": `${i} ${tag} Scale St`,
    "Owner First": `Owner${i}`,
    City: "Spartanburg",
  }));
}

test("T25 counts, duplicates and extra columns stay exactly as before", async () => {
  await db()`INSERT INTO leads (user_id, property_address) VALUES
    (${A.id}, '100  Main St'), (${A.id}, '200    Elm St'), (${B.id}, '300 Other Users Rd')`;
  const data = [
    { "Property Address": "100 main st", "Owner First": "Dup of stored, two spaces" },
    { "Property Address": "  100   MAIN   st ", "Owner First": "Dup of stored, messy" },
    { "Property Address": "200 Elm St", "Owner First": "Stored has four spaces: not a duplicate" },
    { "Property Address": "1 New Rd", "Owner First": "New", Notes: "call after 5", "Owner Age": "70" },
    { "Property Address": "1 new  rd", "Owner First": "Repeat inside the file" },
    { "Property Address": "5   Wide Ave", "Owner First": "Three spaces" },
    { "Property Address": "5 Wide Ave", "Owner First": "Not a repeat of three spaces (quirk)" },
    { "Property Address": "   ", "Owner First": "Blank address" },
    { "Owner First": "No address column" },
    { "Property Address": "300 other users rd", "Owner First": "Only B has it" },
    { "Property Address": "1 NEW RD", "Owner First": "Repeat again", __parsed_extra: ["X1"] },
  ];
  const before = await leadCount(A);
  const res = await api("/api/leads/import", {
    method: "POST",
    user: A,
    body: { filename: "mixed.csv", mapping: MAPPING, data },
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { imported: 5, skipped: 6, total: 11 });
  assert.equal(await leadCount(A), before + 5);

  const rows = await db()`
    SELECT property_address, first_name, property_city, source, custom_data FROM leads
    WHERE user_id = ${A.id} AND source = 'mixed.csv' ORDER BY id`;
  assert.deepEqual(
    rows.map((r) => r.property_address),
    ["200 Elm St", "1 New Rd", "5   Wide Ave", "5 Wide Ave", "300 other users rd"]
  );
  const newRd = rows.find((r) => r.property_address === "1 New Rd");
  assert.deepEqual(JSON.parse(newRd.custom_data), { Notes: "call after 5" });
  assert.equal(rows.find((r) => r.property_address === "200 Elm St").custom_data, null);

  const [rec] = await db()`
    SELECT filename, total_rows, imported_rows, skipped_rows, column_mapping FROM csv_imports
    WHERE user_id = ${A.id} ORDER BY id DESC LIMIT 1`;
  assert.deepEqual(
    { ...rec, column_mapping: JSON.parse(rec.column_mapping) },
    { filename: "mixed.csv", total_rows: 11, imported_rows: 5, skipped_rows: 6, column_mapping: MAPPING }
  );
});

test("T25 10,000 rows import in a few seconds, and importing them again skips them all", async () => {
  const data = bigFile(10_000, "Ten");
  const first = await api("/api/leads/import", {
    method: "POST",
    user: A,
    body: { filename: "ten-k.csv", mapping: MAPPING, data },
    timeoutMs: 120_000,
  });
  assert.equal(first.status, 200, first.text.slice(0, 200));
  assert.deepEqual(first.json, { imported: 10_000, skipped: 0, total: 10_000 });
  assert.ok(first.ms < 10_000, `took ${first.ms} ms`);

  const again = await api("/api/leads/import", {
    method: "POST",
    user: A,
    body: { filename: "ten-k.csv", mapping: MAPPING, data },
    timeoutMs: 120_000,
  });
  assert.deepEqual(again.json, { imported: 0, skipped: 10_000, total: 10_000 });
  assert.ok(again.ms < 10_000, `took ${again.ms} ms`);
});

test("T25 25,001 rows get 400 and nothing is imported", async () => {
  const before = await leadCount(A);
  const beforeImports = await importCount(A);
  const res = await api("/api/leads/import", {
    method: "POST",
    user: A,
    body: { filename: "too-big.csv", mapping: MAPPING, data: bigFile(25_001, "Over") },
    timeoutMs: 120_000,
  });
  assert.equal(res.status, 400, res.text.slice(0, 200));
  assert.equal(await leadCount(A), before);
  assert.equal(await importCount(A), beforeImports);
});

test("T25 another user is answered promptly while a 25,000 row import runs", async () => {
  const big = api("/api/leads/import", {
    method: "POST",
    user: A,
    body: { filename: "max.csv", mapping: MAPPING, data: bigFile(25_000, "Max") },
    timeoutMs: 180_000,
  });
  await new Promise((r) => setTimeout(r, 300));
  const other = await api("/api/leads?pageSize=10", { user: B, timeoutMs: 60_000 });
  assert.equal(other.status, 200, other.text.slice(0, 200));
  assert.ok(other.ms < 3000, `the other user waited ${other.ms} ms`);
  const done = await big;
  assert.equal(done.status, 200, done.text.slice(0, 200));
  assert.deepEqual(done.json, { imported: 25_000, skipped: 0, total: 25_000 });
});
