// Database schema and lockdown steps, shared by the command line scripts
// (scripts/db-migrate.mjs) and the test runner (tests/run.mjs).
//
// Plain Node ESM with the `postgres` package, so it runs on Node 22 and 24
// with no build step. Every function takes an open `postgres` client.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");
export const LOCKDOWN_FILE = path.join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "20261119211831_lock_down_public_api.sql"
);

// Tables that carry a user_id owner column.
export const OWNED_TABLES = [
  "leads",
  "tags",
  "sequences",
  "csv_imports",
  "buyers",
  "settings",
  "calendar_events",
  "google_calendar_tokens",
];

const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES user_profiles(id),
    first_name TEXT,
    last_name TEXT,
    property_address TEXT NOT NULL,
    property_city TEXT,
    property_state TEXT,
    property_zip TEXT,
    mailing_address TEXT,
    mailing_city TEXT,
    mailing_state TEXT,
    mailing_zip TEXT,
    phone TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    latitude REAL,
    longitude REAL,
    source TEXT,
    custom_data TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES user_profiles(id),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6B7280'
  );

  CREATE TABLE IF NOT EXISTS lead_tags (
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (lead_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS sequences (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES user_profiles(id),
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS sequence_steps (
    id SERIAL PRIMARY KEY,
    sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    delay_days INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    template TEXT
  );

  CREATE TABLE IF NOT EXISTS lead_sequences (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    current_step INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    enrolled_at TEXT NOT NULL DEFAULT NOW()::text,
    next_action_at TEXT
  );

  CREATE TABLE IF NOT EXISTS call_log (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    direction TEXT,
    duration INTEGER,
    disposition TEXT,
    notes TEXT,
    called_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS skip_trace_results (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    phones TEXT,
    emails TEXT,
    provider TEXT,
    traced_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS csv_imports (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES user_profiles(id),
    filename TEXT NOT NULL,
    total_rows INTEGER,
    imported_rows INTEGER,
    skipped_rows INTEGER,
    column_mapping TEXT,
    imported_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS buyers (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES user_profiles(id),
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    email TEXT,
    buy_criteria TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    file_type TEXT,
    uploaded_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES user_profiles(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES user_profiles(id),
    title TEXT NOT NULL,
    description TEXT,
    event_type TEXT NOT NULL DEFAULT 'custom',
    start_at TEXT NOT NULL,
    end_at TEXT,
    all_day INTEGER DEFAULT 0,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    buyer_id INTEGER REFERENCES buyers(id) ON DELETE SET NULL,
    google_event_id TEXT,
    google_calendar_id TEXT,
    sync_status TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE TABLE IF NOT EXISTS google_calendar_tokens (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES user_profiles(id),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    calendar_id TEXT,
    sync_enabled INTEGER DEFAULT 1,
    last_sync_at TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_zip ON leads(property_zip);
  CREATE INDEX IF NOT EXISTS idx_leads_state_city ON leads(property_state, property_city);
  CREATE INDEX IF NOT EXISTS idx_lead_sequences_next ON lead_sequences(next_action_at);
  CREATE INDEX IF NOT EXISTS idx_notes_lead ON notes(lead_id);
  CREATE INDEX IF NOT EXISTS idx_call_log_lead ON call_log(lead_id);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_lead ON calendar_events(lead_id);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_buyer ON calendar_events(buyer_id);
`;

// Older databases were created before the user_id columns existed.
const ADD_OWNER_COLUMNS = OWNED_TABLES.map(
  (t) => `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);`
).join("\n");

const OWNER_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_buyers_user ON buyers(user_id);
  CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
  CREATE INDEX IF NOT EXISTS idx_sequences_user ON sequences(user_id);
  CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);
`;

const UNIQUE_CONSTRAINTS = `
  ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_unique;
  ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;
  ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_unique;
  ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_name_user_unique') THEN
      ALTER TABLE tags ADD CONSTRAINT tags_name_user_unique UNIQUE (name, user_id);
    END IF;
  END $$;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_key_user_unique') THEN
      ALTER TABLE settings ADD CONSTRAINT settings_key_user_unique UNIQUE (key, user_id);
    END IF;
  END $$;
`;

/**
 * Create or update the schema. Safe to run more than once.
 * Returns the owner tables that still have rows with no owner (user_id IS NULL);
 * those keep a nullable user_id column until the rows are assigned.
 */
export async function applySchema(sql) {
  // All statements are constant strings: no values are built into SQL here.
  await sql.unsafe(CREATE_TABLES);
  await sql.unsafe(ADD_OWNER_COLUMNS);
  await sql.unsafe(OWNER_INDEXES);
  await sql.unsafe(UNIQUE_CONSTRAINTS);
  return await enforceOwnerNotNull(sql);
}

/** Set user_id NOT NULL on every owner table that has no unowned rows. */
export async function enforceOwnerNotNull(sql) {
  const stillUnowned = [];
  for (const table of OWNED_TABLES) {
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM ${sql(table)} WHERE user_id IS NULL
    `;
    if (count > 0) {
      stillUnowned.push({ table, count });
      continue;
    }
    await sql`ALTER TABLE ${sql(table)} ALTER COLUMN user_id SET NOT NULL`;
  }
  return stillUnowned;
}

/**
 * The old "backfill": give every row that has no owner to one user.
 * Parameterized: the user id is sent as a value, never built into the SQL.
 */
export async function assignUnownedRows(sql, userId) {
  const changed = {};
  for (const table of OWNED_TABLES) {
    const result = await sql`
      UPDATE ${sql(table)} SET user_id = ${userId} WHERE user_id IS NULL
    `;
    changed[table] = result.count;
  }
  return changed;
}

/** Apply the reviewed lockdown file (row level security on, public roles out). */
export async function applyLockdown(sql) {
  if (!existsSync(LOCKDOWN_FILE)) {
    throw new Error(`Lockdown file not found: ${LOCKDOWN_FILE}`);
  }
  const text = await readFile(LOCKDOWN_FILE, "utf8");
  await sql.unsafe(text);
}

export function lockdownFileExists() {
  return existsSync(LOCKDOWN_FILE);
}

/** Host and database name of a connection string, for printing (never the password). */
export function describeTarget(connectionString) {
  const url = new URL(connectionString);
  return { host: url.hostname, port: url.port || "5432", database: url.pathname.replace(/^\//, "") };
}
