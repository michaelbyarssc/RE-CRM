// Direct database access for the tests, plus the seed data.
// Always goes through the guard: only a local database whose name ends in _test.

import postgres from "postgres";
import { assertSafeTestDatabase } from "./config.mjs";

let client;

export function db() {
  if (!client) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL is not set: run the tests with npm test");
    assertSafeTestDatabase(url);
    client = postgres(url, { prepare: false, max: 4, onnotice: () => {} });
  }
  return client;
}

export async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
  }
}

export const USERS = {
  A: { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "owner-a@example.com", role: "user" },
  B: { id: "bbbbbbbb-0000-4000-8000-000000000002", email: "victim-b@example.com", role: "user" },
  ADMIN: { id: "cccccccc-0000-4000-8000-000000000003", email: "admin@example.com", role: "admin" },
};

// Values that belong to B only. No response to A may contain any of them.
export const VICTIM_MARKERS = [
  "ZZVICTIM",
  "555-0199",
  "555-0198",
  "zzvictim@example.com",
  "zzbuyer@example.com",
];

const PAST = "2000-01-01T00:00:00.000Z";

function futureLocal(days) {
  const d = new Date(Date.now() + days * 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00:00`;
}

/** Wipe every table and insert the fixtures. Returns the ids the tests need. */
export async function reseed() {
  const sql = db();
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (tables.length) {
    await sql.unsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`
    );
  }

  for (const u of Object.values(USERS)) {
    await sql`INSERT INTO user_profiles (id, email, role) VALUES (${u.id}, ${u.email}, ${u.role})`;
  }

  const A = USERS.A.id;
  const B = USERS.B.id;
  const one = async (q) => (await q)[0].id;

  // B (the victim)
  const bLead = await one(sql`
    INSERT INTO leads (user_id, first_name, last_name, property_address, property_city, phone, email, status)
    VALUES (${B}, 'Zelda', 'ZZVICTIM', '999 ZZVictim Lane', 'Victimville', '555-0199', 'zzvictim@example.com', 'new')
    RETURNING id`);
  const bBuyer = await one(sql`
    INSERT INTO buyers (user_id, name, company, phone, email)
    VALUES (${B}, 'ZZVICTIM Buyer', 'ZZVictimCo', '555-0198', 'zzbuyer@example.com') RETURNING id`);
  const bTag = await one(sql`
    INSERT INTO tags (user_id, name, color) VALUES (${B}, 'ZZVICTIMTAG', '#FF0000') RETURNING id`);
  const bSeq = await one(sql`
    INSERT INTO sequences (user_id, name, description) VALUES (${B}, 'ZZVICTIM seq', 'victim') RETURNING id`);
  const bStep = await one(sql`
    INSERT INTO sequence_steps (sequence_id, step_order, delay_days, action_type, template)
    VALUES (${bSeq}, 1, 0, 'call', 'ZZVICTIM step for {{first_name}}') RETURNING id`);
  const bEnrollment = await one(sql`
    INSERT INTO lead_sequences (lead_id, sequence_id, current_step, status, next_action_at)
    VALUES (${bLead}, ${bSeq}, 0, 'active', ${PAST}) RETURNING id`);
  await sql`INSERT INTO settings (user_id, key, value) VALUES (${B}, 'reiskip_api_key', 'ZZVICTIM-fake-key')`;

  // A (the caller)
  const aLead = await one(sql`
    INSERT INTO leads (user_id, first_name, last_name, property_address, property_city, phone, email, status, latitude, longitude)
    VALUES (${A}, 'Alice', 'Owner', '1 Alpha St', 'Alphaville', '555-0101', 'alice@example.com', 'new', 34.9, -81.9)
    RETURNING id`);
  const aLead2 = await one(sql`
    INSERT INTO leads (user_id, first_name, last_name, property_address, status, latitude, longitude)
    VALUES (${A}, 'Andy', 'Second', '2 Alpha St', 'new', 34.9, -81.9) RETURNING id`);
  const aBuyer = await one(sql`
    INSERT INTO buyers (user_id, name) VALUES (${A}, 'Alpha Buyer') RETURNING id`);
  const aBuyerSpare = await one(sql`
    INSERT INTO buyers (user_id, name) VALUES (${A}, 'Alpha Spare Buyer') RETURNING id`);
  const aTag = await one(sql`
    INSERT INTO tags (user_id, name, color) VALUES (${A}, 'Alpha tag', '#00FF00') RETURNING id`);
  const aSeq = await one(sql`
    INSERT INTO sequences (user_id, name, description) VALUES (${A}, 'Alpha seq', 'mine') RETURNING id`);
  const aStep = await one(sql`
    INSERT INTO sequence_steps (sequence_id, step_order, delay_days, action_type, template)
    VALUES (${aSeq}, 1, 0, 'call', 'Alpha step for {{first_name}}') RETURNING id`);
  const aEnrollment = await one(sql`
    INSERT INTO lead_sequences (lead_id, sequence_id, current_step, status, next_action_at)
    VALUES (${aLead}, ${aSeq}, 0, 'active', ${PAST}) RETURNING id`);
  const aSeqSpare = await one(sql`
    INSERT INTO sequences (user_id, name) VALUES (${A}, 'Alpha spare seq') RETURNING id`);
  const aEvent = await one(sql`
    INSERT INTO calendar_events (user_id, title, event_type, start_at, status)
    VALUES (${A}, 'Alpha meeting', 'custom', ${futureLocal(2)}, 'scheduled') RETURNING id`);
  const aEventSpare = await one(sql`
    INSERT INTO calendar_events (user_id, title, event_type, start_at, status)
    VALUES (${A}, 'Alpha spare event', 'custom', ${futureLocal(3)}, 'scheduled') RETURNING id`);
  const aNoteSpare = await one(sql`
    INSERT INTO notes (lead_id, content) VALUES (${aLead}, 'Alpha spare note') RETURNING id`);

  return {
    A,
    B,
    ADMIN: USERS.ADMIN.id,
    bLead,
    bBuyer,
    bTag,
    bSeq,
    bStep,
    bEnrollment,
    aLead,
    aLead2,
    aBuyer,
    aBuyerSpare,
    aTag,
    aSeq,
    aStep,
    aEnrollment,
    aSeqSpare,
    aEvent,
    aEventSpare,
    aNoteSpare,
    futureLocal,
  };
}

/** Every table in public that has a user_id column. */
export async function ownerTables() {
  const rows = await db()`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'user_id'
    ORDER BY table_name`;
  return rows.map((r) => r.table_name);
}

/** Map of table -> Map(id -> user_id) for every owner table. */
export async function ownershipSnapshot() {
  const sql = db();
  const snap = {};
  for (const t of await ownerTables()) {
    const rows = await sql`SELECT id, user_id FROM ${sql(t)}`;
    snap[t] = new Map(rows.map((r) => [r.id, r.user_id]));
  }
  return snap;
}
