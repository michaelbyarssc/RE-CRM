import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;

export async function runMigrations() {
  const sql = postgres(connectionString, { prepare: false });

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
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
      name TEXT NOT NULL UNIQUE,
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
      filename TEXT NOT NULL,
      total_rows INTEGER,
      imported_rows INTEGER,
      skipped_rows INTEGER,
      column_mapping TEXT,
      imported_at TEXT NOT NULL DEFAULT NOW()::text
    );

    CREATE TABLE IF NOT EXISTS buyers (
      id SERIAL PRIMARY KEY,
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
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT NOW()::text
    );

    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_zip ON leads(property_zip);
    CREATE INDEX IF NOT EXISTS idx_leads_state_city ON leads(property_state, property_city);
    CREATE INDEX IF NOT EXISTS idx_lead_sequences_next ON lead_sequences(next_action_at);
    CREATE INDEX IF NOT EXISTS idx_notes_lead ON notes(lead_id);
    CREATE INDEX IF NOT EXISTS idx_call_log_lead ON call_log(lead_id);
  `);

  // Seed default tags
  const existing = await sql`SELECT COUNT(*) as count FROM tags`;
  if (Number(existing[0].count) === 0) {
    const defaultTags = [
      ["Hot Lead", "#EF4444"],
      ["Vacant", "#F59E0B"],
      ["Absentee Owner", "#8B5CF6"],
      ["Pre-Foreclosure", "#EC4899"],
      ["Probate", "#6366F1"],
      ["Tax Lien", "#F97316"],
      ["Motivated Seller", "#10B981"],
      ["Cash Buyer", "#06B6D4"],
    ];
    for (const [name, color] of defaultTags) {
      await sql`INSERT INTO tags (name, color) VALUES (${name}, ${color})`;
    }
  }

  await sql.end();
  return { success: true };
}
