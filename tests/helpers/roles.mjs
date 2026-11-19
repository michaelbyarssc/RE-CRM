// Run a statement as one of the Supabase API roles (anon, authenticated)
// inside a transaction that is always rolled back.

import { db } from "./db.mjs";

const ROLLBACK = Symbol("rollback");

/** Returns "allowed", "denied" (permission error 42501) or the error message. */
export async function tryAs(role, statement) {
  try {
    await db().begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await tx.unsafe(statement);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err === ROLLBACK) return "allowed";
    if (err && err.code === "42501") return "denied";
    return `error ${err.code || ""}: ${err.message}`;
  }
  return "allowed";
}

export async function publicTables() {
  const rows = await db()`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  return rows.map((r) => r.tablename);
}

export async function publicSequences() {
  const rows = await db()`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`;
  return rows.map((r) => r.sequencename);
}

export const API_ROLES = ["anon", "authenticated"];
