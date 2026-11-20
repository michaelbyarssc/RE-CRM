// T30. One buyer row whose saved buy criteria is not readable JSON must not
// break the buyer zones API or the buyers screen for every other buyer.
// The shared reader (lib/buy-criteria.mjs) is tested directly, the zones API
// over HTTP, and a source scan keeps app code from parsing the column itself.

import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import { parseBuyCriteriaObject, readBuyCriteria } from "../lib/buy-criteria.mjs";

const A = USERS.A;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AREA = { name: "Spartanburg County", lat: 34.93, lng: -81.99, type: "county" };

// ---------- The reader ----------

test("T30 reader: empty, missing and non-JSON text give null and never throw", () => {
  for (const raw of [null, undefined, "", "   ", "not json", "{areas: Greer}", "{\"areas\":", "Greer, Duncan under 150k"]) {
    assert.equal(readBuyCriteria(raw), null, JSON.stringify(raw));
    assert.equal(parseBuyCriteriaObject(raw), null, JSON.stringify(raw));
  }
});

test("T30 reader: JSON that is not an object gives null", () => {
  for (const raw of ['"Greer"', "42", "true", "[]", '[{"areas":"Greer"}]', "null"]) {
    assert.equal(readBuyCriteria(raw), null, raw);
    assert.equal(parseBuyCriteriaObject(raw), null, raw);
  }
});

test("T30 reader: a value that is not text gives null", () => {
  for (const raw of [42, {}, [], true]) {
    assert.equal(readBuyCriteria(raw), null);
  }
});

test("T30 reader: a good criteria object is returned with its fields", () => {
  const raw = JSON.stringify({ areas: "Greer, Duncan", priceRange: "100k to 200k", geocodedAreas: [AREA] });
  assert.deepEqual(readBuyCriteria(raw), { areas: "Greer, Duncan", priceRange: "100k to 200k", geocodedAreas: [AREA] });
  // What the app writes when the form is saved, before any areas are mapped.
  assert.deepEqual(readBuyCriteria('{"areas":"Greer","priceRange":""}'), { areas: "Greer", priceRange: "", geocodedAreas: [] });
  assert.deepEqual(readBuyCriteria("{}"), { geocodedAreas: [] });
});

test("T30 reader: a number in areas or priceRange is shown as text", () => {
  assert.deepEqual(
    readBuyCriteria(JSON.stringify({ areas: 29301, priceRange: "Under 150k" })),
    { areas: "29301", priceRange: "Under 150k", geocodedAreas: [] }
  );
  assert.deepEqual(readBuyCriteria(JSON.stringify({ priceRange: 150000 })), { priceRange: "150000", geocodedAreas: [] });
  assert.deepEqual(readBuyCriteria(JSON.stringify({ areas: 0, priceRange: 99.5 })), { areas: "0", priceRange: "99.5", geocodedAreas: [] });
});

test("T30 reader: fields of the wrong type are dropped and the good ones kept", () => {
  for (const bad of [{ zip: 29301 }, [29301], ["Greer"], true, false, null]) {
    assert.deepEqual(
      readBuyCriteria(JSON.stringify({ areas: bad, priceRange: bad })),
      { geocodedAreas: [] },
      JSON.stringify(bad)
    );
  }
  // JSON has no NaN; a number too large to store reads back as Infinity and is left out.
  assert.deepEqual(readBuyCriteria('{"areas":1e999,"priceRange":-1e999}'), { geocodedAreas: [] });
  assert.deepEqual(
    readBuyCriteria(JSON.stringify({ areas: "Greer", priceRange: { max: 1 }, geocodedAreas: "Greer" })),
    { areas: "Greer", geocodedAreas: [] }
  );
  assert.deepEqual(readBuyCriteria(JSON.stringify({ areas: ["Greer"], geocodedAreas: { 0: AREA } })), { geocodedAreas: [] });
});

test("T30 reader: malformed map areas are dropped, good ones kept", () => {
  const raw = JSON.stringify({
    areas: "a",
    geocodedAreas: [
      AREA,
      null,
      "Greer",
      42,
      [34.9, -81.9],
      { name: "No position" },
      { name: "Text position", lat: "34.9", lng: "-81.9", type: "city" },
      { name: "Out of range", lat: 134.9, lng: -81.9, type: "city" },
      { name: "", lat: 34.9, lng: -81.9, type: "city" },
      { lat: 34.9, lng: -81.9, type: "city" },
      { name: "Odd type", lat: 34.95, lng: -82.2, type: "planet" },
      { name: "29301", lat: 34.94, lng: -81.93, type: "zip" },
    ],
  });
  assert.deepEqual(readBuyCriteria(raw).geocodedAreas, [
    AREA,
    { name: "Odd type", lat: 34.95, lng: -82.2, type: "other" },
    { name: "29301", lat: 34.94, lng: -81.93, type: "zip" },
  ]);
});

test("T30 reader: parseBuyCriteriaObject keeps every stored field as it is", () => {
  const stored = { areas: "Greer", priceRange: 150000, source: "import", geocodedAreas: "x" };
  assert.deepEqual(parseBuyCriteriaObject(JSON.stringify(stored)), stored);
});

// ---------- The zones API, over HTTP ----------

const BAD_TEXT = "Greer or Duncan, under 150k (typed in by hand)";
let ids;
after(closeDb);

async function setCriteria(buyerId, text) {
  await db()`UPDATE buyers SET buy_criteria = ${text} WHERE id = ${buyerId}`;
}
async function storedCriteria(buyerId) {
  const [row] = await db()`SELECT buy_criteria FROM buyers WHERE id = ${buyerId}`;
  return row.buy_criteria;
}

describe("T30 zones API with one unreadable buyer row", () => {
  beforeEach(async () => {
    ids = await reseed();
  });

  test("T30 GET /api/buyers/zones answers 200 and still returns the good buyers when one row is not JSON", async () => {
    await setCriteria(ids.aBuyer, BAD_TEXT);
    await setCriteria(ids.aBuyerSpare, JSON.stringify({ areas: "Spartanburg County", priceRange: "Under 150k", geocodedAreas: [AREA] }));
    const res = await api("/api/buyers/zones", { user: A });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.ok(Array.isArray(res.json), res.text.slice(0, 200));
    assert.deepEqual(res.json.map((z) => z.id), [ids.aBuyerSpare]);
    assert.deepEqual(res.json[0].geocodedAreas, [AREA]);
    assert.equal(res.json[0].areas, "Spartanburg County");
    assert.equal(res.json[0].priceRange, "Under 150k");
  });

  test("T30 GET /api/buyers/zones skips JSON of the wrong shape and malformed map areas", async () => {
    await setCriteria(ids.aBuyer, "[1,2,3]");
    await setCriteria(ids.aBuyerSpare, JSON.stringify({ areas: 7, geocodedAreas: [AREA, { name: "Broken", lat: "x" }] }));
    const res = await api("/api/buyers/zones", { user: A });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.deepEqual(res.json.map((z) => z.id), [ids.aBuyerSpare]);
    assert.deepEqual(res.json[0].geocodedAreas, [AREA]);
    assert.equal(res.json[0].areas, "7");
  });

  test("T30 POST /api/buyers/zones for a buyer whose row is not JSON answers like a buyer with no areas and keeps the text", async () => {
    await setCriteria(ids.aBuyer, BAD_TEXT);
    const res = await api("/api/buyers/zones", { method: "POST", user: A, body: { buyerId: ids.aBuyer } });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    assert.deepEqual(res.json, { geocoded: 0 });
    assert.equal(await storedCriteria(ids.aBuyer), BAD_TEXT);
  });

  test("T30 POST /api/buyers/zones for a buyer whose areas is the number 29301 looks it up and keeps the number", async () => {
    await setCriteria(ids.aBuyer, JSON.stringify({ areas: 29301, priceRange: "Under 150k" }));
    const res = await api("/api/buyers/zones", { method: "POST", user: A, body: { buyerId: ids.aBuyer } });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    // The geocoder is unreachable in tests, so nothing is found, but "29301" was tried.
    assert.equal(res.json.geocoded, 0);
    assert.equal(res.json.total, 1);
    assert.deepEqual(JSON.parse(await storedCriteria(ids.aBuyer)), {
      areas: 29301,
      priceRange: "Under 150k",
      geocodedAreas: [],
    });
  });

  test("T30 POST /api/buyers/zones for a buyer whose areas is a list or an object answers like a buyer with no areas", async () => {
    for (const areas of [["Greer"], { zip: 29301 }]) {
      const text = JSON.stringify({ areas, priceRange: "Under 150k" });
      await setCriteria(ids.aBuyer, text);
      const res = await api("/api/buyers/zones", { method: "POST", user: A, body: { buyerId: ids.aBuyer } });
      assert.equal(res.status, 200, res.text.slice(0, 200));
      assert.deepEqual(res.json, { geocoded: 0 });
      assert.equal(await storedCriteria(ids.aBuyer), text);
    }
  });

  test("T30 POST /api/buyers/zones keeps every other stored field when it saves the map areas", async () => {
    await setCriteria(ids.aBuyer, JSON.stringify({ areas: "Greer", priceRange: 150000, source: "import" }));
    const res = await api("/api/buyers/zones", { method: "POST", user: A, body: { buyerId: ids.aBuyer } });
    assert.equal(res.status, 200, res.text.slice(0, 200));
    // The geocoder is unreachable in tests, so nothing is found.
    assert.equal(res.json.geocoded, 0);
    assert.deepEqual(JSON.parse(await storedCriteria(ids.aBuyer)), {
      areas: "Greer",
      priceRange: 150000,
      source: "import",
      geocodedAreas: [],
    });
  });
});

// ---------- Source scan ----------
//
// App code must read the buy_criteria column through lib/buy-criteria.mjs,
// never with its own JSON.parse. The scan reads each file under app/,
// components/ and lib/ (except the reader itself) as one piece of text, so a
// call split over several lines is still found. It only sees the column's own
// name inside the JSON.parse call: it cannot see the value after it has been
// copied into a variable with another name first, or taken out of an object
// under another name (for example `const { buyCriteria: c } = buyer`).

const SCAN_DIRS = ["app", "components", "lib"];
const READER_FILE = path.join("lib", "buy-criteria.mjs");
// "JSON.parse(" and, before the call's first closing bracket, buyCriteria or buy_criteria.
const DIRECT_PARSE = /JSON\.parse\s*\([^)]*buy_?criteria/gi;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Line numbers (from 1) where a direct JSON.parse of buy criteria starts in this text. */
function directParseLines(text) {
  return [...text.matchAll(DIRECT_PARSE)].map((m) => text.slice(0, m.index).split("\n").length);
}

test("T30 the source scan pattern finds direct parses, also split over two lines", () => {
  assert.deepEqual(directParseLines("const c = JSON.parse(buyer.buyCriteria);"), [1]);
  assert.deepEqual(directParseLines("a\nconst c = JSON.parse(\n  buyer.buyCriteria\n);"), [2]);
  assert.deepEqual(directParseLines("const c = JSON.parse(row.buy_criteria);"), [1]);
  assert.deepEqual(directParseLines("const c = JSON.parse(raw);"), []);
  assert.deepEqual(directParseLines("value = JSON.parse(raw);\nconst buyCriteria = 1;"), []);
  assert.deepEqual(directParseLines(readFileSync(path.join(root, READER_FILE), "utf8")), []);
});

test("T30 no file under app/, components/ or lib/ calls JSON.parse on buyCriteria itself", () => {
  const hits = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const rel = path.relative(root, file);
      if (rel === READER_FILE) continue;
      for (const line of directParseLines(readFileSync(file, "utf8"))) hits.push(`${rel}:${line}`);
    }
  }
  assert.deepEqual(hits, [], `use readBuyCriteria from lib/buy-criteria.mjs instead: ${hits.join(", ")}`);
});
