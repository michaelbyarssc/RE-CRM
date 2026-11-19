#!/usr/bin/env node
// Give an existing user the admin role. This is the only way to make an admin.
//
// Usage:
//   npm run db:make-admin -- owner@example.com
//   npm run db:make-admin -- --id <user id>
//   node --env-file=.env.local scripts/db-make-admin.mjs owner@example.com
//
// The user must have signed in once (so their profile row exists).
// Exits with code 1 when no profile matches. When more than one profile has
// that email, nothing changes: the matching ids are printed and the script
// exits with code 1, so you can run it again with --id.

import postgres from "postgres";
import { describeTarget } from "./lib/migrations.mjs";

async function main() {
  const args = process.argv.slice(2);
  const byId = args[0] === "--id";
  const value = byId ? args[1] : args[0];
  if (!value || value.startsWith("-") || args.length !== (byId ? 2 : 1)) {
    console.error("Usage: npm run db:make-admin -- <email>   or   npm run db:make-admin -- --id <user id>");
    return 1;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Example: node --env-file=.env.local scripts/db-make-admin.mjs <email>  (or --id <user id>)");
    return 1;
  }
  const target = describeTarget(url);
  console.log(`About to change database "${target.database}" on host ${target.host}:${target.port}`);

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const matches = byId
      ? await sql`SELECT id, email, role FROM user_profiles WHERE id = ${value}`
      : await sql`SELECT id, email, role FROM user_profiles WHERE lower(email) = lower(${value}) ORDER BY id`;
    if (matches.length === 0) {
      console.error(
        byId
          ? `No user profile with id ${value}.`
          : `No user profile with email ${value}. The user must sign in once first.`
      );
      return 1;
    }
    if (matches.length > 1) {
      console.error(`More than one user profile has the email ${value}. Nothing changed. Matching profiles:`);
      for (const m of matches) console.error(`  ${m.id}  ${m.email}  role: ${m.role}`);
      console.error("Run again with --id <user id> to pick one.");
      return 1;
    }
    const [profile] = matches;
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
