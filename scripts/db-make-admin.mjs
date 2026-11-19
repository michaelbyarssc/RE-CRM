#!/usr/bin/env node
// Give an existing user the admin role. This is the only way to make an admin.
//
// Usage:
//   npm run db:make-admin -- owner@example.com
//   node --env-file=.env.local scripts/db-make-admin.mjs owner@example.com
//
// The user must have signed in once (so their profile row exists).
// Exits with code 1 when no profile has that email.

import postgres from "postgres";
import { describeTarget } from "./lib/migrations.mjs";

async function main() {
  const email = process.argv[2];
  if (!email || process.argv.length > 3) {
    console.error("Usage: npm run db:make-admin -- <email>");
    return 1;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Example: node --env-file=.env.local scripts/db-make-admin.mjs <email>");
    return 1;
  }
  const target = describeTarget(url);
  console.log(`About to change database "${target.database}" on host ${target.host}:${target.port}`);

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const [profile] = await sql`
      SELECT id, email, role FROM user_profiles WHERE lower(email) = lower(${email}) LIMIT 1`;
    if (!profile) {
      console.error(`No user profile with email ${email}. The user must sign in once first.`);
      return 1;
    }
    if (profile.role === "admin") {
      console.log(`${profile.email} (${profile.id}) is already an admin. Nothing changed.`);
      return 0;
    }
    await sql`
      UPDATE user_profiles SET role = 'admin', updated_at = ${new Date().toISOString()}
      WHERE id = ${profile.id}`;
    console.log(`Set role admin for ${profile.email} (${profile.id}); previous role: ${profile.role}.`);
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("make-admin failed:", err.message);
    process.exit(1);
  }
);
