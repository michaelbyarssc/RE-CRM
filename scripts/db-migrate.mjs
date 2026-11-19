#!/usr/bin/env node
// Create or update the database schema, then apply the lockdown file
// (supabase/migrations/20261119211831_lock_down_public_api.sql).
//
// Usage:
//   node --env-file=.env.local scripts/db-migrate.mjs
//   npm run db:migrate                        (DATABASE_URL already in the environment)
//   npm run db:migrate -- --assign-unowned-to owner@example.com
//
// --assign-unowned-to <email>  gives every row that has no owner (user_id IS NULL)
//                              to the existing user with that email. This is the
//                              old "backfill" from the removed /api/migrate route.
//
// Reads DATABASE_URL from the environment. Prints the host and database first.
// Safe to run more than once. Never changes a role.

import postgres from "postgres";
import {
  applySchema,
  applyLockdown,
  assignUnownedRows,
  enforceOwnerNotNull,
  describeTarget,
} from "./lib/migrations.mjs";

function parseArgs(argv) {
  const args = { assignTo: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--assign-unowned-to") {
      args.assignTo = argv[++i];
      if (!args.assignTo) throw new Error("--assign-unowned-to needs an email");
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown option: ${argv[i]}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node --env-file=.env.local scripts/db-migrate.mjs [--assign-unowned-to <email>]");
    return 0;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Example: node --env-file=.env.local scripts/db-migrate.mjs");
    return 1;
  }
  const target = describeTarget(url);
  console.log(`About to migrate database "${target.database}" on host ${target.host}:${target.port}`);

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    let unowned = await applySchema(sql);
    console.log("Schema is up to date.");

    if (args.assignTo) {
      const [profile] = await sql`
        SELECT id, email FROM user_profiles WHERE lower(email) = lower(${args.assignTo}) LIMIT 1`;
      if (!profile) {
        console.error(`No user profile with email ${args.assignTo}. Nothing was assigned.`);
        return 1;
      }
      const changed = await assignUnownedRows(sql, profile.id);
      console.log(`Assigned rows with no owner to ${profile.email}:`, changed);
      unowned = await enforceOwnerNotNull(sql);
    }

    for (const { table, count } of unowned) {
      console.warn(
        `Warning: ${table} has ${count} row(s) with no owner; user_id stays nullable. ` +
          "Run again with --assign-unowned-to <email> to assign them."
      );
    }

    await applyLockdown(sql);
    console.log("Lockdown applied: row level security on, anon and authenticated have no table access.");
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
  }
);
