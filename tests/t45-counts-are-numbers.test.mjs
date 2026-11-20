// T45. Every count the server sends is a number, never text.
//
// Postgres returns count(*) as a bigint, and the database driver hands a
// bigint to JavaScript as text. The code said "number" anyway, so
// GET /api/leads sent "total": "60". A screen that wanted a real number then
// showed "Leads (50)" for 60 leads and hid the paging bar, so leads 51 to 60
// could not be reached. The map compared the text "0" with the number 0.
// Now every count is read with count() from drizzle-orm, which turns the
// value into a number before it leaves the database layer.
//
// The checks: the leads list total (with search, status filter, both, and a
// search that matches nothing), the map counts, the count after geocoding,
// the enrolled count of each sequence, and the dashboard lead counts. Each
// count must have typeof "number" and equal the real count of the caller's
// own rows. A source scan stops new code that would send a count, sum or
// average as text (see the README, "Counts are numbers").

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import { forEachNode, lineOf, listSourceFiles, parseRepoFile, parseSource, ts } from "./helpers/source-scan.mjs";

const root = process.env.TEST_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Two users that are not in the shared seed. The app creates their profile
// on the first request. C has no leads at all. D has one lead without
// coordinates, for the geocode POST.
const C = { id: "dddddddd-0000-4000-8000-000000000045", email: "empty-c@example.com", role: "user" };
const D = { id: "eeeeeeee-0000-4000-8000-000000000045", email: "one-lead-d@example.com", role: "user" };

// User A ends up with 60 leads (the shared seed gives A two "new" leads with
// coordinates on Alpha St):
//   Maple Ave, contacted: 12   Maple Ave, new: 8
//   Oak St, contacted: 8       Oak St, new: 30 (5 of them without coordinates)
// So: 60 in all, "Maple" 20, contacted 20, "Maple" and contacted 12, new 40,
// 5 without coordinates. B gets extra leads that match the same search and
// status, so a count that leaked B's rows would be wrong.
const A_TOTAL = 60;
const A_MAPLE = 20;
const A_CONTACTED = 20;
const A_MAPLE_CONTACTED = 12;
const A_NEW = 40;
const A_UNGEOCODED = 5;

let ids;
let aSeq2;

before(async () => {
  ids = await reseed();
  const sql = db();
  const rows = [];
  const add = (n, user, street, status, withCoords) => {
    for (let i = 0; i < n; i++) {
      rows.push({
        user_id: user,
        first_name: "Pat",
        last_name: `Lee ${rows.length}`,
        property_address: `${100 + rows.length} ${street}`,
        status,
        latitude: withCoords ? 34.95 : null,
        longitude: withCoords ? -81.93 : null,
      });
    }
  };
  add(12, USERS.A.id, "Maple Ave", "contacted", true);
  add(8, USERS.A.id, "Maple Ave", "new", true);
  add(8, USERS.A.id, "Oak St", "contacted", true);
  add(25, USERS.A.id, "Oak St", "new", true);
  add(A_UNGEOCODED, USERS.A.id, "Oak St", "new", false);
  add(15, USERS.B.id, "Maple Ave", "contacted", false);
  await sql`INSERT INTO leads ${sql(rows)}`;
  await sql`INSERT INTO user_profiles (id, email, role) VALUES (${D.id}, ${D.email}, 'user')`;
  await sql`INSERT INTO leads (user_id, property_address, status) VALUES (${D.id}, '7 Pine Rd', 'new')`;

  // Sequences of A: "Alpha seq" has 1 active enrollment from the seed; add 3
  // more active and 3 that are not active. "Alpha spare seq" stays empty.
  // A second sequence gets 2 active.
  const aLeads = await sql`SELECT id FROM leads WHERE user_id = ${USERS.A.id} AND id <> ${ids.aLead} ORDER BY id LIMIT 8`;
  const enroll = (leadId, seqId, status) => ({ lead_id: leadId, sequence_id: seqId, status, current_step: 0 });
  [aSeq2] = await sql`INSERT INTO sequences (user_id, name) VALUES (${USERS.A.id}, 'Alpha second seq') RETURNING id`;
  aSeq2 = aSeq2.id;
  await sql`INSERT INTO lead_sequences ${sql([
    enroll(aLeads[0].id, ids.aSeq, "active"),
    enroll(aLeads[1].id, ids.aSeq, "active"),
    enroll(aLeads[2].id, ids.aSeq, "active"),
    enroll(aLeads[3].id, ids.aSeq, "completed"),
    enroll(aLeads[4].id, ids.aSeq, "paused"),
    enroll(aLeads[5].id, ids.aSeq, "stopped"),
    enroll(aLeads[6].id, aSeq2, "active"),
    enroll(aLeads[7].id, aSeq2, "active"),
  ])}`;
});
after(closeDb);

/** Fails with a clear message when value is not a real number equal to expected. */
function assertCount(value, expected, what) {
  assert.equal(
    typeof value,
    "number",
    `${what}: expected the number ${expected}, got ${JSON.stringify(value)} (${typeof value}). ` +
      "A count that arrives as text breaks the screens."
  );
  assert.equal(value, expected, `${what}: wrong count`);
}

async function realCount(query) {
  const [row] = await query;
  return row.n;
}

// ---- Leads list ----

async function leadsPage(query, user = USERS.A) {
  const res = await api(`/api/leads?${query}`, { user });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  return res.json;
}

test("T45 GET /api/leads: total is the number 60, page 1 has 50 leads and page 2 the other 10", async () => {
  const sql = db();
  const expected = await realCount(sql`SELECT count(*)::int AS n FROM leads WHERE user_id = ${USERS.A.id}`);
  assert.equal(expected, A_TOTAL, "the seed itself");

  const p1 = await leadsPage("page=1");
  assertCount(p1.total, A_TOTAL, "total on page 1");
  assert.equal(p1.pageSize, 50);
  assert.equal(p1.leads.length, 50);

  const p2 = await leadsPage("page=2");
  assertCount(p2.total, A_TOTAL, "total on page 2");
  assert.equal(p2.leads.length, A_TOTAL - 50);

  const seen = new Set([...p1.leads, ...p2.leads].map((l) => l.id));
  assert.equal(seen.size, A_TOTAL, "the two pages together hold every lead once");
  assert.ok([...p1.leads, ...p2.leads].every((l) => l.userId === USERS.A.id), "only the caller's own leads");
});

test("T45 GET /api/leads: total is a number with a search, a status filter and both", async () => {
  const sql = db();
  const A = USERS.A.id;
  // Each case: the query, the expected count, and the same count read from the seeded columns.
  const cases = [
    ["search=Maple", A_MAPLE, sql`SELECT count(*)::int AS n FROM leads WHERE user_id = ${A} AND property_address LIKE '%Maple%'`],
    ["status=contacted", A_CONTACTED, sql`SELECT count(*)::int AS n FROM leads WHERE user_id = ${A} AND status = 'contacted'`],
    ["status=new", A_NEW, sql`SELECT count(*)::int AS n FROM leads WHERE user_id = ${A} AND status = 'new'`],
    [
      "search=Maple&status=contacted",
      A_MAPLE_CONTACTED,
      sql`SELECT count(*)::int AS n FROM leads WHERE user_id = ${A} AND property_address LIKE '%Maple%' AND status = 'contacted'`,
    ],
    ["status=all", A_TOTAL, sql`SELECT count(*)::int AS n FROM leads WHERE user_id = ${A}`],
  ];
  for (const [query, expected, seeded] of cases) {
    assert.equal(await realCount(seeded), expected, `the seed itself, for ${query}`);
    const page = await leadsPage(query);
    assertCount(page.total, expected, `total for ${query}`);
    assert.equal(page.leads.length, Math.min(50, expected), `${query}: leads on page 1`);
  }
});

test("T45 GET /api/leads: a search that matches nothing gives the number 0", async () => {
  const page = await leadsPage("search=NoSuchStreetZZ");
  assert.strictEqual(page.total, 0, `total is ${JSON.stringify(page.total)}`);
  assert.deepEqual(page.leads, []);
});

test("T45 GET /api/leads: a user with no leads gets the number 0", async () => {
  const page = await leadsPage("page=1", C);
  assert.strictEqual(page.total, 0, `total is ${JSON.stringify(page.total)}`);
  assert.deepEqual(page.leads, []);
});

// ---- Map ----

test("T45 GET /api/leads/geocode: total and ungeocoded are numbers equal to the real counts", async () => {
  const sql = db();
  const total = await realCount(sql`SELECT count(*)::int AS n FROM leads WHERE user_id = ${USERS.A.id}`);
  const ungeocoded = await realCount(
    sql`SELECT count(*)::int AS n FROM leads WHERE user_id = ${USERS.A.id} AND latitude IS NULL`
  );
  assert.equal(ungeocoded, A_UNGEOCODED, "the seed itself");

  const res = await api("/api/leads/geocode", { user: USERS.A });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assertCount(res.json.total, total, "map total");
  assertCount(res.json.ungeocoded, ungeocoded, "map ungeocoded");
  assert.equal(res.json.leads.length, total - ungeocoded, "leads on the map");
});

test("T45 GET /api/leads/geocode: a user with no leads gets the number 0 twice", async () => {
  const res = await api("/api/leads/geocode", { user: C });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.strictEqual(res.json.total, 0, `total is ${JSON.stringify(res.json.total)}`);
  assert.strictEqual(res.json.ungeocoded, 0, `ungeocoded is ${JSON.stringify(res.json.ungeocoded)}`);
  assert.deepEqual(res.json.leads, []);
});

test("T45 POST /api/leads/geocode: remaining is a number equal to the leads still without coordinates", async () => {
  // D has one lead without coordinates. The route asks the outside geocoder
  // for it. The test harness blocks every outside call (helpers/no-network.cjs),
  // so the lead normally stays without coordinates. Either way, the route then
  // counts what is left, and that count must be a number equal to the database.
  const res = await api("/api/leads/geocode", { method: "POST", user: D });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  const left = await realCount(
    db()`SELECT count(*)::int AS n FROM leads WHERE user_id = ${D.id} AND latitude IS NULL`
  );
  assertCount(res.json.remaining, left, "remaining");

  // With nothing left to geocode the route answers at once.
  const none = await api("/api/leads/geocode", { method: "POST", user: C });
  assert.equal(none.status, 200, none.text.slice(0, 200));
  assert.strictEqual(none.json.remaining, 0, `remaining is ${JSON.stringify(none.json.remaining)}`);
});

// ---- Sequences ----

test("T45 GET /api/sequences: enrolledCount is a number equal to the active enrollments", async () => {
  const sql = db();
  const active = (seqId) =>
    realCount(sql`SELECT count(*)::int AS n FROM lead_sequences WHERE sequence_id = ${seqId} AND status = 'active'`);
  const expected = new Map([
    [ids.aSeq, await active(ids.aSeq)],
    [ids.aSeqSpare, await active(ids.aSeqSpare)],
    [aSeq2, await active(aSeq2)],
  ]);
  assert.deepEqual([...expected.values()], [4, 0, 2], "the seed itself");

  const res = await api("/api/sequences", { user: USERS.A });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.equal(res.json.length, 3, "A's three sequences");
  for (const seq of res.json) {
    assert.ok(expected.has(seq.id), `unexpected sequence ${seq.id}`);
    assertCount(seq.enrolledCount, expected.get(seq.id), `enrolledCount of "${seq.name}"`);
  }
  assert.strictEqual(res.json.find((s) => s.id === ids.aSeqSpare).enrolledCount, 0);
});

// ---- Dashboard ----

// The labels of the status cards, as in LEAD_STATUSES in lib/constants.ts.
const STATUS_LABELS = ["New", "Contacted", "In Process", "Offer Sent", "Under Contract", "Closed", "Dead"];

test("T45 the dashboard shows the real lead counts (total and per status)", async () => {
  const res = await api("/", { user: USERS.A });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  // Each card of the shared Card component: the title ends its header, and the
  // first element of the card content holds the number.
  const cards = new Map(
    [...res.text.matchAll(/>([^<>]+)<\/div><\/div><div data-slot="card-content"[^>]*><div[^>]*>(\d+)</g)].map((m) => [
      m[1].trim(),
      Number(m[2]),
    ])
  );
  const markupHint =
    "The dashboard card markup may have changed (components/ui/card.tsx or app/(dashboard)/page.tsx), " +
    "so this test's pattern needs an update. This is not a count bug.";
  for (const label of ["Total Leads", ...STATUS_LABELS]) {
    assert.ok(cards.has(label), `no card "${label}" found. Cards found: ${[...cards.keys()].join(", ") || "none"}. ${markupHint}`);
  }
  assert.equal(cards.get("Total Leads"), A_TOTAL, "Total Leads");
  assert.equal(cards.get("New"), A_NEW, "New");
  assert.equal(cards.get("Contacted"), A_CONTACTED, "Contacted");
  const sum = STATUS_LABELS.reduce((total, label) => total + cards.get(label), 0);
  assert.equal(sum, A_TOTAL, "the status cards add up to the total");
});

// ---- Source scan ----

// Casts that Postgres sends back as numbers. bigint, int8 and numeric come back as text.
const NUMBER_CAST = /^\s*::\s*(?:int|int2|int4|integer|smallint|float|float4|float8|real|double\s+precision)\b/i;
// Calls whose arguments never reach JavaScript as a value.
const CLAUSES = new Set(["where", "having", "orderBy", "groupBy"]);
// drizzle-orm helpers that give text on purpose.
const TEXT_HELPERS = new Set(["sum", "avg", "sumDistinct", "avgDistinct"]);

/** The SQL of a template: its literal parts, with "?" where a ${...} was. */
function sqlOf(template) {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
  return template.head.text + template.templateSpans.map((span) => "?" + span.literal.text).join("");
}

/** True when each count(, sum( and avg( in the SQL is followed directly by a number cast. */
function everyAggregateCast(text) {
  for (const m of text.matchAll(/\b(?:count|sum|avg)\s*\(/gi)) {
    let i = m.index + m[0].length;
    for (let depth = 1; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    if (!NUMBER_CAST.test(text.slice(i))) return false;
  }
  return true;
}

/** True when node is (inside) an argument of a .where(), .having(), .orderBy() or .groupBy() call. */
function insideClause(node) {
  for (let n = node; n.parent; n = n.parent) {
    const call = n.parent;
    if (
      ts.isCallExpression(call) &&
      call.arguments.includes(n) &&
      ts.isPropertyAccessExpression(call.expression) &&
      CLAUSES.has(call.expression.name.text)
    ) {
      return true;
    }
  }
  return false;
}

/** True when node is directly followed by .mapWith(. */
function followedByMapWith(node) {
  const p = node.parent;
  return ts.isPropertyAccessExpression(p) && p.expression === node && p.name.text === "mapWith";
}

/**
 * "line N: ..." for every aggregate that comes back as text:
 * - a sql`` template with a count(, sum( or avg( that is not cast to a number type and not followed by .mapWith(;
 * - a call to sum, avg, sumDistinct or avgDistinct imported from drizzle-orm without .mapWith(.
 * Aggregates inside .where(), .having(), .orderBy() or .groupBy() never reach JavaScript and are skipped.
 */
function aggregatesSentAsText(sourceFile) {
  const helpers = new Set();
  for (const st of sourceFile.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== "drizzle-orm") continue;
    for (const el of st.importClause?.namedBindings?.elements ?? []) {
      if (TEXT_HELPERS.has((el.propertyName ?? el.name).text)) helpers.add(el.name.text);
    }
  }
  const found = [];
  forEachNode(sourceFile, (node) => {
    let what;
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(sourceFile) === "sql") {
      if (!everyAggregateCast(sqlOf(node.template))) what = "sql`` aggregate without a number cast";
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) {
      what = `${node.expression.text}() from drizzle-orm without .mapWith(Number)`;
    }
    if (what && !followedByMapWith(node) && !insideClause(node)) found.push(`line ${lineOf(sourceFile, node)}: ${what}`);
  });
  return found;
}

const scan = (text) => aggregatesSentAsText(parseSource("sample.ts", text)).map((hit) => hit.split(":")[0]);

test("T45 the source scan finds an aggregate that comes back as text and nothing else", () => {
  const flagged = ["line 1"];
  // sql`` templates: each aggregate needs its own number cast.
  assert.deepEqual(scan("const q = db.select({ n: sql<number>`count(*)` });"), flagged);
  assert.deepEqual(scan("x = sql`SELECT SUM(${t.a}) FROM t`;"), flagged);
  assert.deepEqual(scan("x = sql`avg(price)::numeric`;"), flagged);
  assert.deepEqual(scan("x = sql`count(*)::bigint`;"), flagged);
  assert.deepEqual(scan("x = sql`count(*)::int8`;"), flagged);
  assert.deepEqual(scan("\n\ny = db.execute(sql`select count(id) from leads`);"), ["line 3"]);
  assert.deepEqual(scan("x = sql`select count(*) as n, max(id)::int as m`;"), flagged);
  assert.deepEqual(scan("x = sql`select count(*)::int as n, sum(id) as s`;"), flagged);
  assert.deepEqual(scan("x = sql<number>`count(*)::int`;"), []);
  assert.deepEqual(scan("x = sql`sum(coalesce(${t.a}, 0))::int`;"), []);
  assert.deepEqual(scan("x = sql`sum(${t.a})::float8`;"), []);
  assert.deepEqual(scan("x = sql`avg(${t.a})::float`;"), []);
  assert.deepEqual(scan("x = sql`avg(${t.a}) :: double precision`;"), []);
  assert.deepEqual(scan("x = sql<number>`count(*)`.mapWith(Number);"), []);
  // Only the SQL is read: not comments, strings, other tags or JavaScript inside ${...}.
  assert.deepEqual(scan("x = sql`lower(${t.a})`; // count(*) in a comment"), []);
  assert.deepEqual(scan('x = "count(*)"; y = other`count(*)`;'), []);
  assert.deepEqual(scan('x = sql`lower(${"sum("})`;'), []);
  // Inside where, having, order by and group by the value never reaches JavaScript.
  assert.deepEqual(scan("q.having(sql`count(*) > 1`);"), []);
  assert.deepEqual(scan("q.orderBy(desc(sql`count(*)`));"), []);
  assert.deepEqual(scan("q.where(sql`${t.n} > (select avg(n) from t)`).groupBy(sql`sum(1)`);"), []);
  // ...but a select earlier in the same chain is still read.
  assert.deepEqual(scan("db.select({ n: sql`count(*)` }).from(t).where(x);"), flagged);
  // sum and avg from drizzle-orm give text without .mapWith(.
  assert.deepEqual(scan('import { sum } from "drizzle-orm"; db.select({ s: sum(t.a) });'), flagged);
  assert.deepEqual(scan('import { avg as average } from "drizzle-orm"; x = average(t.a);'), flagged);
  assert.deepEqual(scan('import { sumDistinct, avgDistinct } from "drizzle-orm"; x = [sumDistinct(t.a), avgDistinct(t.a)];'), [
    "line 1",
    "line 1",
  ]);
  assert.deepEqual(scan('import { sum } from "drizzle-orm"; x = sum(t.a).mapWith(Number);'), []);
  assert.deepEqual(scan('import { sum, gt } from "drizzle-orm"; q.having(gt(sum(t.a), 5));'), []);
  assert.deepEqual(scan('import { count } from "drizzle-orm"; db.select({ n: count() });'), []);
  assert.deepEqual(scan("function sum(a, b) { return a + b; } x = sum(1, 2);"), []);
  assert.deepEqual(scan('import { sum } from "./math"; x = sum(1, 2);'), []);
});

test("T45 no code in lib/ or app/ writes a count, sum or average that comes back as text", () => {
  const found = listSourceFiles(root, ["lib", "app"]).flatMap((rel) =>
    aggregatesSentAsText(parseRepoFile(root, rel)).map((hit) => `${rel} ${hit}`)
  );
  assert.deepEqual(
    found,
    [],
    "Postgres sends count(*), sum() and avg() as a bigint or numeric, and the database driver turns that into text, " +
      "even when the code says sql<number>. What to write instead:\n" +
      "- In a select, use count() from drizzle-orm. It reads the value as a number.\n" +
      "- For sum() and avg() from drizzle-orm, add .mapWith(Number).\n" +
      "- In raw SQL (a sql`` template, also inside db.execute()), cast in the SQL: count(*)::int, sum(x)::float8.\n" +
      "Found:\n" +
      found.join("\n")
  );
});
