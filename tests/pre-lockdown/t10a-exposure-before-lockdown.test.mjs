// T10 (part 1). Runs before the lockdown file is applied.
// Proves the test database mirrors production today: the public API roles can
// read and change every table (capsule facts F12 and F13).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeDb } from "../helpers/db.mjs";
import { tryAs, publicTables, API_ROLES } from "../helpers/roles.mjs";

after(closeDb);

test("T10 precondition: the test schema has the 16 app tables", async () => {
  const tables = await publicTables();
  assert.equal(tables.length, 16, `tables: ${tables.join(", ")}`);
});

test("T10 precondition: anon and authenticated can select and update every table", async () => {
  const tables = await publicTables();
  for (const role of API_ROLES) {
    for (const t of tables) {
      assert.equal(await tryAs(role, `SELECT count(*) FROM public."${t}"`), "allowed", `${role} select ${t}`);
      assert.equal(
        await tryAs(role, `UPDATE public."${t}" SET ${t === "lead_tags" ? "tag_id = tag_id" : "id = id"} WHERE false`),
        "allowed",
        `${role} update ${t}`
      );
    }
  }
  assert.equal(await tryAs("anon", `UPDATE public.user_profiles SET role = 'admin'`), "allowed");
});
