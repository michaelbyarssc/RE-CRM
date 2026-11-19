// T19. The test database guard cannot be pointed at a database that is not a
// local test database (review finding F-GUARD-QUERY).
//
// Two layers: the URL check before connecting, and a check of what the
// server says after connecting (before anything is changed). These tests
// need no running app.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as guard from "./helpers/config.mjs";
import { db, closeDb } from "./helpers/db.mjs";

after(closeDb);

const HOSTILE_URLS = [
  // remote or odd hosts
  "postgres://u:p@db.example.com:5432/recrm_test",
  "postgres://u:p@10.0.0.5/recrm_test",
  "postgres://u:p@127.0.0.1,evil.example/recrm_test",
  "postgres://u:p@/recrm_test",
  "postgres:///recrm_test",
  // userinfo tricks
  "postgres://127.0.0.1@evil.example/x_test",
  "postgres://127.0.0.1:5432@evil.example/x_test",
  "postgres://u:p%40127.0.0.1@evil.example/x_test",
  // wrong name
  "postgres://u:p@127.0.0.1:5432/postgres",
  "postgres://u:p@127.0.0.1:5432/recrm_test_prod",
  "postgres://u:p@127.0.0.1:5432/my_test_db",
  "postgres://u:p@127.0.0.1:5432/",
  // query strings and fragments (the driver turns query parameters into connection options)
  "postgres://u:p@127.0.0.1:5432/recrm_test?database=postgres",
  "postgres://u:p@127.0.0.1:5432/recrm_test?host=db.example.com",
  "postgres://u:p@127.0.0.1:5432/recrm_test?options=-c%20search_path%3Dx",
  "postgres://u:p@127.0.0.1:5432/recrm_test?",
  "postgres://u:p@127.0.0.1:5432/recrm_test#frag",
  "postgres://u:p@127.0.0.1:5432/recrm_test#",
  "postgres://u:p@127.0.0.1:5432/x?y=1/recrm_test",
  // not postgres
  "mysql://u:p@127.0.0.1/recrm_test",
  "not a url",
];

test("T19 the URL guard refuses every hostile test database URL", () => {
  const accepted = [];
  for (const url of HOSTILE_URLS) {
    try {
      guard.assertSafeTestDatabase(url);
      accepted.push(url);
    } catch {
      // refused, as it should be
    }
  }
  assert.deepEqual(accepted, [], "these URLs were accepted");
});

test("T19 the URL guard still accepts the local test databases", () => {
  for (const url of [
    guard.DEFAULT_TEST_DATABASE_URL,
    "postgres://recrm_test:recrm_test@localhost:5432/recrm_test",
    "postgresql://u:p@[::1]:5433/other_test",
  ]) {
    assert.ok(guard.assertSafeTestDatabase(url).database.endsWith("_test"), url);
  }
});

// A stand-in for a postgres.js client: a tagged template that answers one row.
function fakeServer(row) {
  const calls = [];
  const sql = async (strings) => {
    calls.push(strings.join("?"));
    return [row];
  };
  sql.calls = calls;
  return sql;
}

test("T19 after connecting, the server must report a _test database on a loopback address or a local socket", async () => {
  assert.equal(typeof guard.assertConnectedToTestDatabase, "function", "guard for the connected server exists");
  const refused = [
    { current_database: "postgres", inet_server_addr: "127.0.0.1" },
    { current_database: "template1", inet_server_addr: null },
    { current_database: "recrm_test_prod", inet_server_addr: "127.0.0.1" },
    { current_database: "recrm_test", inet_server_addr: "10.1.2.3" },
    { current_database: "recrm_test", inet_server_addr: "192.168.0.10" },
    { current_database: "recrm_test", inet_server_addr: "::ffff:10.0.0.1" },
    { current_database: "recrm_test", inet_server_addr: "2001:db8::1" },
  ];
  for (const row of refused) {
    await assert.rejects(guard.assertConnectedToTestDatabase(fakeServer(row)), JSON.stringify(row));
  }
  for (const row of [
    { current_database: "recrm_test", inet_server_addr: "127.0.0.1" },
    { current_database: "recrm_test", inet_server_addr: "127.0.1.1" },
    { current_database: "recrm_test", inet_server_addr: "::1" },
    { current_database: "recrm_test", inet_server_addr: "::ffff:127.0.0.1" },
    { current_database: "recrm_test", inet_server_addr: null },
  ]) {
    const sql = fakeServer(row);
    await guard.assertConnectedToTestDatabase(sql);
    assert.match(sql.calls[0], /current_database\(\)/);
    assert.match(sql.calls[0], /inet_server_addr\(\)/);
  }
});

test("T19 the real test database passes the connected-server guard", async () => {
  assert.equal(typeof guard.assertConnectedToTestDatabase, "function");
  const info = await guard.assertConnectedToTestDatabase(db());
  assert.ok(info.database.endsWith("_test"));
});

test("T19 the runner and the seed helper check the server before changing anything", async () => {
  const { readFileSync } = await import("node:fs");
  const root = new URL("..", import.meta.url);
  const runner = readFileSync(new URL("tests/run.mjs", root), "utf8");
  const check = runner.indexOf("assertConnectedToTestDatabase(");
  const drop = runner.indexOf("DROP SCHEMA");
  assert.ok(check > 0 && check < drop, "run.mjs checks the server before DROP SCHEMA");
  const seed = readFileSync(new URL("tests/helpers/db.mjs", root), "utf8");
  const seedCheck = seed.indexOf("assertConnectedToTestDatabase(");
  const truncate = seed.indexOf("TRUNCATE");
  assert.ok(seedCheck > 0 && seedCheck < truncate, "db.mjs checks the server before TRUNCATE");
});
