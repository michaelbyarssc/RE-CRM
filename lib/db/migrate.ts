import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;

export async function runMigrations() {
  const sql = postgres(connectionString, { prepare: false });

  await sql.unsafe(`
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
    CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id);
    CREATE INDEX IF NOT EXISTS idx_lead_sequences_next ON lead_sequences(next_action_at);
    CREATE INDEX IF NOT EXISTS idx_notes_lead ON notes(lead_id);
    CREATE INDEX IF NOT EXISTS idx_call_log_lead ON call_log(lead_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_lead ON calendar_events(lead_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_buyer ON calendar_events(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_buyers_user ON buyers(user_id);
    CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
    CREATE INDEX IF NOT EXISTS idx_sequences_user ON sequences(user_id);
    CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);
  `);

  // Add user_id columns to existing tables (safe if already exist)
  await sql.unsafe(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);
    ALTER TABLE tags ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);
    ALTER TABLE sequences ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);
    ALTER TABLE csv_imports ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);
    ALTER TABLE buyers ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);
    ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);
    ALTER TABLE google_calendar_tokens ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES user_profiles(id);
  `);

  // Drop old unique constraints that need to become composite
  await sql.unsafe(`
    ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_unique;
    ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key;
    ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_unique;
    ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_key_key;
  `);

  // Add composite unique constraints
  await sql.unsafe(`
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
  `);

  // Seed default tags only if none exist
  const existing = await sql`SELECT COUNT(*) as count FROM tags`;
  if (Number(existing[0].count) === 0) {
    // Tags will be seeded per-user when they first log in
  }

  await sql.end();
  return { success: true };
}

/**
 * Backfill existing data to assign all rows to a specific user.
 * Call this once after the first admin user is established.
 */
export async function backfillUserData(userId: string) {
  const sql = postgres(connectionString, { prepare: false });

  await sql.unsafe(`
    UPDATE leads SET user_id = '${userId}' WHERE user_id IS NULL;
    UPDATE tags SET user_id = '${userId}' WHERE user_id IS NULL;
    UPDATE sequences SET user_id = '${userId}' WHERE user_id IS NULL;
    UPDATE csv_imports SET user_id = '${userId}' WHERE user_id IS NULL;
    UPDATE buyers SET user_id = '${userId}' WHERE user_id IS NULL;
    UPDATE settings SET user_id = '${userId}' WHERE user_id IS NULL;
    UPDATE calendar_events SET user_id = '${userId}' WHERE user_id IS NULL;
    UPDATE google_calendar_tokens SET user_id = '${userId}' WHERE user_id IS NULL;
  `);

  // Now enforce NOT NULL
  await sql.unsafe(`
    ALTER TABLE leads ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE tags ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE sequences ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE csv_imports ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE buyers ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE settings ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE calendar_events ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE google_calendar_tokens ALTER COLUMN user_id SET NOT NULL;
  `);

  await sql.end();
  return { success: true };
}
