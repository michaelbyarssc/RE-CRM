// T24. scripts/db-make-admin.mjs never promotes a profile it cannot tell
// apart (review finding F-MAKE-ADMIN): when more than one profile has the
// email it changes nothing, prints the matching ids and exits 1. `--id`
// picks one profile exactly. Runs the real script against the test database.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

const SCRIPT = path.join(process.env.TEST_REPO_ROOT, "scripts", "db-make-admin.mjs");
const DUP1 = "dddddddd-0000-4000-8000-000000000011";
const DUP2 = "dddddddd-0000-4000-8000-000000000012";

beforeEach(async () => {
  await reseed();
  await db()`INSERT INTO user_profiles (id, email, role) VALUES
    (${DUP1}, 'twice@example.com', 'user'), (${DUP2}, 'Twice@Example.com', 'user')`;
});
after(async () => {
  await reseed();
  await closeDb();
});

function makeAdmin(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH, DATABASE_URL: process.env.TEST_DATABASE_URL },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
async function roleOf(id) {
  const [row] = await db()`SELECT role FROM user_profiles WHERE id = ${id}`;
  return row?.role;
}

test("T24 an email shared by two profiles changes nothing, lists both ids and exits 1", async () => {
  const r = makeAdmin("twice@example.com");
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes(DUP1) && r.out.includes(DUP2), r.out);
  assert.equal(await roleOf(DUP1), "user");
  assert.equal(await roleOf(DUP2), "user");
});

test("T24 --id promotes exactly that profile", async () => {
  const r = makeAdmin("--id", DUP2);
  assert.equal(r.code, 0, r.out);
  assert.equal(await roleOf(DUP2), "admin");
  assert.equal(await roleOf(DUP1), "user");
});

test("T24 --id with an unknown id changes nothing and exits 1", async () => {
  const [{ n: before }] = await db()`SELECT count(*)::int AS n FROM user_profiles WHERE role = 'admin'`;
  const r = makeAdmin("--id", "eeeeeeee-0000-4000-8000-000000000099");
  assert.equal(r.code, 1, r.out);
  const [{ n }] = await db()`SELECT count(*)::int AS n FROM user_profiles WHERE role = 'admin'`;
  assert.equal(n, before);
});

test("T24 an email that matches one profile still works", async () => {
  const r = makeAdmin(USERS.A.email.toUpperCase());
  assert.equal(r.code, 0, r.out);
  assert.equal(await roleOf(USERS.A.id), "admin");
});

test("T24 wrong arguments print the usage and exit 1", async () => {
  for (const args of [[], ["--id"], ["a@example.com", "b@example.com"], ["--id", DUP1, "extra"]]) {
    const r = makeAdmin(...args);
    assert.equal(r.code, 1, `${JSON.stringify(args)}: ${r.out}`);
    assert.match(r.out, /Usage/, JSON.stringify(args));
  }
  assert.equal(await roleOf(DUP1), "user");
});
