// T10 (part 2). Runs after the runner applied
// supabase/migrations/20261119000000_lock_down_public_api.sql.
// The public API roles must be denied everything; row level security must be
// on for every table. The rest of the suite runs after the lockdown, which
// proves the app still works.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db, closeDb } from "./helpers/db.mjs";
import { tryAs, publicTables, publicSequences, API_ROLES } from "./helpers/roles.mjs";

after(closeDb);

test("T10 lockdown: anon and authenticated are denied select, insert, update and delete on every table", async () => {
  const tables = await publicTables();
  assert.ok(tables.length >= 16);
  for (const role of API_ROLES) {
    for (const t of tables) {
      const col = t === "lead_tags" ? "tag_id" : "id";
      assert.equal(await tryAs(role, `SELECT 1 FROM public."${t}" LIMIT 1`), "denied", `${role} select ${t}`);
      assert.equal(await tryAs(role, `INSERT INTO public."${t}" DEFAULT VALUES`), "denied", `${role} insert ${t}`);
      assert.equal(await tryAs(role, `UPDATE public."${t}" SET ${col} = ${col} WHERE false`), "denied", `${role} update ${t}`);
      assert.equal(await tryAs(role, `DELETE FROM public."${t}" WHERE false`), "denied", `${role} delete ${t}`);
    }
  }
});

test("T10 lockdown: anon cannot make anyone an admin", async () => {
  for (const role of API_ROLES) {
    assert.equal(await tryAs(role, `UPDATE public.user_profiles SET role = 'admin'`), "denied");
  }
});

test("T10 lockdown: anon and authenticated cannot use the id sequences", async () => {
  for (const role of API_ROLES) {
    for (const s of await publicSequences()) {
      assert.equal(await tryAs(role, `SELECT nextval('public."${s}"')`), "denied", `${role} nextval ${s}`);
    }
  }
});

test("T10 lockdown: row level security is on for every table", async () => {
  const rows = await db()`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;
  assert.ok(rows.length >= 16);
  for (const r of rows) assert.equal(r.relrowsecurity, true, `RLS on ${r.relname}`);
});

test("T10 lockdown: a table created later is not exposed to the API roles", async () => {
  const ROLLBACK = Symbol("rollback");
  let privileges;
  try {
    await db().begin(async (tx) => {
      await tx.unsafe(`CREATE TABLE public.zz_lockdown_probe (id serial primary key)`);
      privileges = await tx`
        SELECT has_table_privilege('anon', 'public.zz_lockdown_probe', 'SELECT') AS anon_select,
               has_table_privilege('authenticated', 'public.zz_lockdown_probe', 'INSERT') AS auth_insert`;
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  assert.deepEqual({ ...privileges[0] }, { anon_select: false, auth_insert: false });
});
