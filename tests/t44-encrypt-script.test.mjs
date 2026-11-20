// T44. The one-off script scripts/encrypt-existing-secrets.mjs, run as a
// child process against the test database. Dry run by default; --apply
// (which needs the app's key fingerprint) encrypts every plain-text secret
// and both Google token columns in one transaction, and a second run has
// nothing to do. It never prints a value.

import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import {
  MARKER,
  STORED_FORMAT,
  dummySecret,
  encryptSetting,
  decryptSetting,
  encryptTokenValue,
  decryptTokenValue,
  testKey,
  testRing,
} from "./helpers/secrets.mjs";
import { keyRingFromEnv, decrypt, versionOf, currentFingerprint } from "../lib/secrets/box.mjs";
import { settingContext, SERVER_WRITTEN_SETTING_KEYS } from "../lib/secrets/policy.mjs";
import { readFileSync } from "node:fs";

const SCRIPT = path.join(process.env.TEST_REPO_ROOT || ".", "scripts", "encrypt-existing-secrets.mjs");
const A = USERS.A;
const B = USERS.B;

function run(args = [], env = {}) {
  const base = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    SETTINGS_ENCRYPTION_KEY: testKey(),
  };
  const merged = Object.fromEntries(Object.entries({ ...base, ...env }).filter(([, v]) => v !== undefined));
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: merged, encoding: "utf8", timeout: 60_000 });
  return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

/** The fingerprint of the newest key in these variables (what the app's debug answer would show). */
function fingerprintOf(env = {}) {
  const vars = { SETTINGS_ENCRYPTION_KEY: testKey(), ...env };
  return currentFingerprint(keyRingFromEnv(Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined))));
}

/** --apply with the correct expected fingerprint for the key the script is given. */
function runApply(env = {}) {
  return run(["--apply", `--expect-fingerprint=${fingerprintOf(env)}`], env);
}

/** A key the app does not use, and the app's real fingerprint. */
function wrongKeyEnv() {
  return { SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
}

let seeded;

async function seed() {
  const sql = db();
  const v = {
    authToken: dummySecret("auth"),
    padded: `  ${MARKER}-padded-value-0001  `,
    already: dummySecret("already"),
    aAccess: dummySecret("a-access"),
    aRefresh: dummySecret("a-refresh"),
    bAccess: dummySecret("b-access"),
    bRefresh: dummySecret("b-refresh"),
  };
  const one = async (q) => (await q)[0].id;
  const ids = {
    authToken: await one(sql`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'twilio_auth_token', ${v.authToken}) RETURNING id`),
    padded: await one(sql`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'reiskip_api_key', ${v.padded}) RETURNING id`),
    phone: await one(sql`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'twilio_phone_number', '+15555550150') RETURNING id`),
    empty: await one(sql`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'twilio_account_sid', '') RETURNING id`),
    spaces: await one(sql`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'skipengine_api_key', '   ') RETURNING id`),
    already: await one(sql`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'batchskiptracing_api_key', ${encryptSetting(A.id, "batchskiptracing_api_key", v.already)}) RETURNING id`),
  };
  const future = new Date(Date.now() + 3600_000).toISOString();
  ids.aTokens = await one(sql`
    INSERT INTO google_calendar_tokens (user_id, access_token, refresh_token, expires_at, calendar_id, sync_enabled)
    VALUES (${A.id}, ${v.aAccess}, ${v.aRefresh}, ${future}, 'primary', 1) RETURNING id`);
  // Half encrypted: the access token is, the refresh token is not.
  ids.bTokens = await one(sql`
    INSERT INTO google_calendar_tokens (user_id, access_token, refresh_token, expires_at, calendar_id, sync_enabled)
    VALUES (${B.id}, ${encryptTokenValue(B.id, "access_token", v.bAccess)}, ${v.bRefresh}, ${future}, 'primary', 1) RETURNING id`);
  return { v, ids };
}

async function snapshot() {
  const sql = db();
  return {
    settings: await sql`SELECT id, user_id, key, value, updated_at FROM settings ORDER BY id`,
    tokens: await sql`SELECT id, user_id, access_token, refresh_token, expires_at, updated_at FROM google_calendar_tokens ORDER BY id`,
  };
}
async function settingRow(id) {
  return (await db()`SELECT * FROM settings WHERE id = ${id}`)[0];
}
async function tokensOf(userId) {
  return (await db()`SELECT * FROM google_calendar_tokens WHERE user_id = ${userId}`)[0];
}
function assertQuiet(out) {
  assert.ok(!out.includes(MARKER), "the script output contains no secret");
  assert.ok(!out.includes("ZZVICTIM-fake-key"), "the script output contains no secret");
  assert.ok(!out.includes("enc:v"), "the script output contains no stored value");
  assert.ok(!out.includes(testKey()), "the script output contains no key");
}

beforeEach(async () => {
  await reseed();
  seeded = await seed();
});
afterEach(async () => {
  const sql = db();
  await sql`DROP TRIGGER IF EXISTS zz_change_during_run ON settings`;
  await sql`DROP FUNCTION IF EXISTS zz_change_during_run()`;
  await sql`DELETE FROM settings WHERE user_id IS NULL`;
  await sql`ALTER TABLE settings ALTER COLUMN user_id SET NOT NULL`;
});
after(closeDb);

test("T44 --help prints usage; an unknown option is a usage error", () => {
  const help = run(["--help"]);
  assert.equal(help.status, 0, help.out);
  assert.match(help.out, /--apply/);
  const bad = run(["--force"]);
  assert.equal(bad.status, 1, bad.out);
  assert.match(bad.out, /Unknown option/);
});

test("T44 the dry run prints the target, the key version (never its fingerprint), counts, and changes nothing", async () => {
  const before = await snapshot();
  const r = run();
  assert.equal(r.status, 0, r.out);
  assertQuiet(r.out);
  // The target comes from TEST_DATABASE_URL, whatever database the suite uses.
  const target = new URL(process.env.TEST_DATABASE_URL);
  const database = decodeURIComponent(target.pathname.replace(/^\//, ""));
  assert.ok(r.out.includes(`database "${database}" on host ${target.hostname}:${target.port || "5432"}`), r.out.split("\n")[0]);
  assert.ok(!r.out.includes(currentFingerprint(testRing())), "never prints the fingerprint of its own key");
  assert.match(r.out, /Encryption key here: version 1\n/);
  assert.match(r.out, /dry run/i);
  assert.match(r.out, /to encrypt \(plain text\): 3/, "A's two plain secrets and B's legacy row");
  assert.deepEqual(await snapshot(), before);
});

test("T44 --apply encrypts every plain-text secret and token, leaves the rest alone, and the app can read it", async () => {
  const { v, ids } = seeded;
  const before = await snapshot();
  const r = runApply();
  assert.equal(r.status, 0, r.out);
  assertQuiet(r.out);

  const auth = await settingRow(ids.authToken);
  assert.match(auth.value, STORED_FORMAT);
  assert.equal(decryptSetting(A.id, "twilio_auth_token", auth.value), v.authToken);
  const padded = await settingRow(ids.padded);
  assert.equal(decryptSetting(A.id, "reiskip_api_key", padded.value), v.padded, "the plain text is not trimmed or changed");
  const [bLegacy] = await db()`SELECT value FROM settings WHERE user_id = ${B.id} AND key = 'reiskip_api_key'`;
  assert.equal(decryptSetting(B.id, "reiskip_api_key", bLegacy.value), "ZZVICTIM-fake-key");

  for (const k of ["phone", "empty", "spaces", "already"]) {
    const was = before.settings.find((s) => s.id === ids[k]);
    assert.deepEqual(await settingRow(ids[k]), was, `${k} is left alone`);
  }
  const after = await snapshot();
  for (const row of after.settings) {
    const was = before.settings.find((s) => s.id === row.id);
    assert.equal(row.updated_at, was.updated_at, `updated_at of setting ${row.id} is unchanged`);
  }

  const aT = await tokensOf(A.id);
  assert.equal(decryptTokenValue(A.id, "access_token", aT.access_token), v.aAccess);
  assert.equal(decryptTokenValue(A.id, "refresh_token", aT.refresh_token), v.aRefresh);
  const bT = await tokensOf(B.id);
  const bWas = before.tokens.find((t) => t.user_id === B.id);
  assert.equal(bT.access_token, bWas.access_token, "the encrypted half is left as it is");
  assert.equal(decryptTokenValue(B.id, "refresh_token", bT.refresh_token), v.bRefresh, "the plain half is completed");
  for (const row of after.tokens) {
    assert.equal(row.updated_at, before.tokens.find((t) => t.id === row.id).updated_at);
  }

  const settingsRes = await api("/api/settings", { user: A });
  assert.equal(settingsRes.status, 200, settingsRes.text);
  assert.deepEqual(settingsRes.json.secrets.twilio_auth_token, { set: true, last4: v.authToken.slice(-4) });
  assert.deepEqual(settingsRes.json.secrets.reiskip_api_key, { set: true, last4: "0001" });
  assert.deepEqual(settingsRes.json.values, { twilio_phone_number: "+15555550150" });
  for (const user of [A, B]) {
    const g = await api("/api/calendar/google", { user });
    assert.equal(g.status, 200, g.text);
    assert.equal(g.json.connected, true, `${user.email} is still connected`);
  }

  // A second run has nothing to do.
  const snap = await snapshot();
  const again = runApply();
  assert.equal(again.status, 0, again.out);
  assertQuiet(again.out);
  assert.match(again.out, /Nothing to do/);
  assert.deepEqual(await snapshot(), snap);
});

test("T44 a missing or malformed key, or a missing DATABASE_URL, exits 1 and changes nothing", async () => {
  const before = await snapshot();
  const noKey = run(["--apply"], { SETTINGS_ENCRYPTION_KEY: undefined });
  assert.equal(noKey.status, 1, noKey.out);
  assert.match(noKey.out, /SETTINGS_ENCRYPTION_KEY/);
  const short = randomBytes(16).toString("base64");
  const badKey = run(["--apply"], { SETTINGS_ENCRYPTION_KEY: short });
  assert.equal(badKey.status, 1, badKey.out);
  assert.ok(!badKey.out.includes(short), "the bad key is not printed");
  const noDb = run(["--apply"], { DATABASE_URL: undefined });
  assert.equal(noDb.status, 1, noDb.out);
  assert.match(noDb.out, /DATABASE_URL/);
  assert.deepEqual(await snapshot(), before);
});

test("T44 values encrypted with another key: exit 2, the row ids are listed, and nothing changes", async () => {
  const other = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
  const [row] = await db()`
    INSERT INTO settings (user_id, key, value)
    VALUES (${A.id}, 'some_other_key', ${encryptSetting(A.id, "some_other_key", dummySecret("other"), other)}) RETURNING id`;
  const before = await snapshot();
  for (const args of [[], ["--apply", `--expect-fingerprint=${fingerprintOf()}`]]) {
    const r = run(args);
    assert.equal(r.status, 2, r.out);
    assertQuiet(r.out);
    assert.match(r.out, new RegExp(`settings.*\\b${row.id}\\b`));
    assert.match(r.out, /does not match/);
  }
  assert.deepEqual(await snapshot(), before, "nothing is changed, not even the plain-text rows");
});

test("T44 with SETTINGS_ENCRYPTION_KEY_V2 present, version 1 values are re-encrypted with version 2", async () => {
  assert.equal(runApply().status, 0);
  const v2 = randomBytes(32).toString("base64");
  const ring12 = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: testKey(), SETTINGS_ENCRYPTION_KEY_V2: v2 });
  const r = runApply({ SETTINGS_ENCRYPTION_KEY_V2: v2 });
  assert.equal(r.status, 0, r.out);
  assertQuiet(r.out);
  assert.match(r.out, /version 2/);
  assert.match(r.out, /re-encrypt/);
  const auth = await settingRow(seeded.ids.authToken);
  assert.equal(versionOf(auth.value), 2);
  assert.equal(decrypt(ring12, auth.value, settingContext(A.id, "twilio_auth_token")), seeded.v.authToken);
  const onlyV2 = run([], { SETTINGS_ENCRYPTION_KEY: undefined, SETTINGS_ENCRYPTION_KEY_V2: v2 });
  assert.equal(onlyV2.status, 0, onlyV2.out);
  assert.match(onlyV2.out, /Nothing to do/, "after the re-encryption the old key is no longer needed");
});

test("T44 a row that changes during the run is left alone and counted, and the next run encrypts it", async () => {
  const { ids } = seeded;
  const changed = dummySecret("changed-during-run");
  // When the script updates the first row, a trigger changes the second one
  // inside the same transaction, before the script reaches it.
  await db().unsafe(`
    CREATE FUNCTION zz_change_during_run() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE settings SET value = '${changed}' WHERE id = ${ids.padded};
      RETURN NULL;
    END $$;
    CREATE TRIGGER zz_change_during_run AFTER UPDATE ON settings
      FOR EACH ROW WHEN (OLD.id = ${ids.authToken}) EXECUTE FUNCTION zz_change_during_run();
  `);
  const r = runApply();
  assert.equal(r.status, 0, r.out);
  assertQuiet(r.out);
  assert.match(r.out, /changed during the run[^\n]*: 1/);
  assert.equal((await settingRow(ids.padded)).value, changed, "the row changed by someone else is not overwritten");
  assert.match((await settingRow(ids.authToken)).value, STORED_FORMAT);

  await db()`DROP TRIGGER zz_change_during_run ON settings`;
  const again = runApply();
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /to encrypt \(plain text\): 1/);
  assert.equal(decryptSetting(A.id, "reiskip_api_key", (await settingRow(ids.padded)).value), changed);
});

test("T44 a failure after the commit says the changes were saved, not that nothing changed", async () => {
  const sql = db();
  await sql`DELETE FROM google_calendar_tokens`;
  // Inside the script's transaction, a trigger renames a column the check
  // afterwards reads. The rename commits with the changes, so the check fails
  // after the commit.
  await sql.unsafe(`
    CREATE FUNCTION zz_change_during_run() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'google_calendar_tokens' AND column_name = 'access_token') THEN
        EXECUTE 'ALTER TABLE google_calendar_tokens RENAME COLUMN access_token TO zz_access_token';
      END IF;
      RETURN NULL;
    END $$;
    CREATE TRIGGER zz_change_during_run AFTER UPDATE ON settings
      FOR EACH ROW EXECUTE FUNCTION zz_change_during_run();
  `);
  try {
    const r = runApply();
    assert.notEqual(r.status, 0, r.out);
    assertQuiet(r.out);
    assert.match(r.out, /The changes were saved, but the check afterwards did not finish/);
    assert.match(r.out, /dry run again/);
    assert.ok(!r.out.includes("nothing was changed"), r.out);
    assert.match((await settingRow(seeded.ids.authToken)).value, STORED_FORMAT, "the changes really were saved");
  } finally {
    await sql`DROP TRIGGER IF EXISTS zz_change_during_run ON settings`;
    await sql.unsafe(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'google_calendar_tokens' AND column_name = 'zz_access_token') THEN
          ALTER TABLE google_calendar_tokens RENAME COLUMN zz_access_token TO access_token;
        END IF;
      END $$;`);
  }
});

test("T44 a failure before the commit says nothing was changed", async () => {
  const before = await snapshot();
  // A trigger that fails makes the transaction roll back.
  await db().unsafe(`
    CREATE FUNCTION zz_change_during_run() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test failure'; END $$;
    CREATE TRIGGER zz_change_during_run AFTER UPDATE ON settings
      FOR EACH ROW EXECUTE FUNCTION zz_change_during_run();
  `);
  const r = runApply();
  assert.equal(r.status, 1, r.out);
  assertQuiet(r.out);
  assert.match(r.out, /Failed, nothing was changed: database error/);
  assert.deepEqual(await snapshot(), before);
});

test("T44 a first run on plain text only, with a WRONG key and the app's real fingerprint, changes nothing and exits 2", async () => {
  // Only plain text: there is no encrypted row that could reveal the wrong key.
  await db()`DELETE FROM settings WHERE key = 'batchskiptracing_api_key'`;
  await db()`DELETE FROM google_calendar_tokens WHERE user_id = ${B.id}`;
  const before = await snapshot();
  const appFingerprint = fingerprintOf();
  const wrong = wrongKeyEnv();
  for (const flag of [[`--expect-fingerprint=${appFingerprint}`], ["--expect-fingerprint", appFingerprint.toUpperCase()]]) {
    const r = run(["--apply", ...flag], wrong);
    assert.equal(r.status, 2, r.out);
    assertQuiet(r.out);
    assert.ok(!r.out.includes(wrong.SETTINGS_ENCRYPTION_KEY));
    assert.match(r.out, /NOT the key the app uses/);
    assert.ok(r.out.includes(`does not match the expected fingerprint ${appFingerprint}`), "shows the expected value only");
    assert.ok(!r.out.includes(fingerprintOf(wrong)), "never shows the fingerprint of the key here");
    assert.match(r.out, /Use the same SETTINGS_ENCRYPTION_KEY as the app/);
    assert.match(r.out, /Nothing was changed/);
  }
  assert.deepEqual(await snapshot(), before);
});

test("T44 --apply without --expect-fingerprint exits 1, says where to get it, and changes nothing", async () => {
  const before = await snapshot();
  const r = run(["--apply"]);
  assert.equal(r.status, 1, r.out);
  assertQuiet(r.out);
  assert.match(r.out, /--expect-fingerprint/);
  assert.match(r.out, /GET \/api\/calendar\/google\?action=debug/);
  assert.match(r.out, /settingsKey\.fingerprint/);
  assert.match(r.out, /This script never shows a fingerprint itself/);
  assert.deepEqual(await snapshot(), before);
});

test("T44 a malformed --expect-fingerprint exits 1 and changes nothing", async () => {
  const before = await snapshot();
  for (const args of [
    ["--apply", "--expect-fingerprint=1234"],
    ["--apply", "--expect-fingerprint=zzzzzzzz"],
    ["--apply", `--expect-fingerprint=${fingerprintOf()}0`],
    ["--apply", "--expect-fingerprint="],
    ["--apply", "--expect-fingerprint"],
    ["--expect-fingerprint=nothex!!"],
  ]) {
    const r = run(args);
    assert.equal(r.status, 1, `${args.join(" ")}: ${r.out}`);
  }
  assert.deepEqual(await snapshot(), before);
});

test("T44 the dry run checks a given fingerprint: a match goes on, a mismatch exits 2; the closing line names the next command", async () => {
  const before = await snapshot();
  const plain = run();
  assert.equal(plain.status, 0, plain.out);
  assert.match(plain.out, /Next: read the fingerprint from the app's admin debug answer/);
  assert.match(plain.out, /settingsKey\.fingerprint\)\. Optionally test it with a dry run plus --expect-fingerprint=<fingerprint>/);
  assert.match(plain.out, /then run again with --apply --expect-fingerprint=<fingerprint>\./);
  const match = run([`--expect-fingerprint=${fingerprintOf().toUpperCase()}`]);
  assert.equal(match.status, 0, match.out);
  assert.match(match.out, /matches the expected fingerprint/);
  assert.match(match.out, /Dry run: 6 plain-text value\(s\) would be encrypted and 0 value\(s\) re-encrypted with the current key version\./, "3 saved keys and 3 Google token values");
  // The fingerprint already matched, so the next step is exact.
  assert.ok(match.out.includes(`Next: run again with --apply --expect-fingerprint=${fingerprintOf()}`), match.out);
  assert.ok(!/Optionally test it/.test(match.out), "no advice to test it again");
  const wrong = run(["--expect-fingerprint=00000000"]);
  assert.equal(wrong.status, 2, wrong.out);
  assert.match(wrong.out, /NOT the key the app uses/);
  assert.deepEqual(await snapshot(), before);
});

test("T44 plain-text secrets in rows with no owner are listed, left alone, and give exit code 3 on every run", async () => {
  const sql = db();
  await sql`ALTER TABLE settings ALTER COLUMN user_id DROP NOT NULL`;
  const ownerless = dummySecret("ownerless");
  const [plainRow] = await sql`INSERT INTO settings (user_id, key, value) VALUES (NULL, 'reiskip_api_key', ${ownerless}) RETURNING id`;
  const [blankRow] = await sql`INSERT INTO settings (user_id, key, value) VALUES (NULL, 'twilio_auth_token', '  ') RETURNING id`;
  const [publicRow] = await sql`INSERT INTO settings (user_id, key, value) VALUES (NULL, 'twilio_phone_number', '+15555550170') RETURNING id`;
  const listed = new RegExp(`no owner: settings ${plainRow.id}\\.`);

  const dry = run();
  assert.equal(dry.status, 3, dry.out);
  assertQuiet(dry.out);
  assert.match(dry.out, listed, "only the plain-text secret is listed, not the blank or public rows");
  assert.match(dry.out, /The app never reads these rows/);
  assert.match(dry.out, /--assign-unowned-to <email>/);

  const applied = runApply();
  assert.equal(applied.status, 3, applied.out);
  assertQuiet(applied.out);
  assert.match(applied.out, listed);
  assert.match((await settingRow(seeded.ids.authToken)).value, STORED_FORMAT, "the rows with an owner were encrypted");
  for (const id of [plainRow.id, blankRow.id, publicRow.id]) {
    assert.equal((await settingRow(id)).user_id, null);
  }
  assert.equal((await settingRow(plainRow.id)).value, ownerless, "the ownerless row is left alone");

  const later = runApply();
  assert.equal(later.status, 3, later.out);
  assert.match(later.out, /Nothing to do/);
  assert.match(later.out, listed);

  await sql`DELETE FROM settings WHERE id = ${plainRow.id}`;
  const clean = runApply();
  assert.equal(clean.status, 0, clean.out);
});

test("T44 the script never prints the fingerprint of its own key, except echoing a matching expected value", async () => {
  const own = fingerprintOf();
  const wrong = wrongKeyEnv();
  // [name, result, fingerprint of the key that run holds]
  const runs = [
    ["dry", run(), own],
    ["applyWithoutFlag", run(["--apply"]), own],
    ["mismatchDry", run(["--expect-fingerprint=0000abcd"]), own],
    ["mismatchApply", run(["--apply", "--expect-fingerprint=0000abcd"]), own],
    ["wrongKeyDry", run([], wrong), fingerprintOf(wrong)],
    ["wrongKeyApply", run(["--apply", `--expect-fingerprint=${own}`], wrong), fingerprintOf(wrong)],
  ];
  for (const [name, r, held] of runs) {
    assert.ok(!r.out.toLowerCase().includes(held), `${name}: the fingerprint of the key it holds must not appear`);
  }
  // Matching runs: the value only appears as an echo of what was given on the
  // command line (the match line, and in a dry run the exact next command).
  const echoes = [`matches the expected fingerprint ${own}`, `--apply --expect-fingerprint=${own}`];
  for (const [r, expectedHits] of [[run([`--expect-fingerprint=${own}`]), 2], [runApply(), 1]]) {
    assert.equal(r.status, 0, r.out);
    assert.equal(r.out.split(own).length - 1, expectedHits, "only the echoes of the given value");
    let rest = r.out;
    for (const e of echoes) rest = rest.split(e).join("");
    assert.ok(!rest.includes(own), "every appearance is one of the echoes");
  }
});

test("T44 the server-only Google connect marker stays plain and unchanged, with its own count line", async () => {
  const marker = "a".repeat(64);
  const [row] = await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, '_google_oauth_pending', ${marker}) RETURNING *`;
  const dry = run();
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /^  server-only settings \(names starting with _\), skipped: 1 \(_google_oauth_pending\)$/m, "listed by name");
  assert.ok(!/^Note:/m.test(dry.out), "a name the app writes itself gives no note");
  assert.match(dry.out, /to encrypt \(plain text\): 3/, "the marker is not counted as a plain-text secret");
  const applied = runApply();
  assert.equal(applied.status, 0, applied.out);
  assert.ok(!/Still plain text/.test(applied.out), "the marker is not listed as still plain text");
  assert.deepEqual(await settingRow(row.id), row, "the marker row is untouched");
  const again = runApply();
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /Nothing to do/);
});

test("T44 the output names each table in plain words and prints only the lines that apply", () => {
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^Saved keys \(settings table\): \d+ rows looked at$/m);
  assert.match(r.out, /^Google Calendar connections \(google_calendar_tokens table\): 2 rows \(4 values\) looked at$/m);
  const google = r.out.slice(r.out.indexOf("Google Calendar connections"));
  const googleSection = google.slice(0, google.indexOf("\n\n"));
  assert.ok(!/public settings|server-only settings/.test(googleSection), "settings-only lines are not in the Google section");
  assert.match(r.out, /server-only settings/, "but they are in the settings section");
});

test("T44 after a rotation the closing lines say re-encrypted, not encrypted", async () => {
  assert.equal(runApply().status, 0);
  const v2 = randomBytes(32).toString("base64");
  const env = { SETTINGS_ENCRYPTION_KEY_V2: v2 };
  const dry = run([], env);
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /Dry run: 0 plain-text value\(s\) would be encrypted and \d+ value\(s\) re-encrypted with the current key version\./);
  const applied = runApply(env);
  assert.equal(applied.status, 0, applied.out);
  assert.match(applied.out, /Saved: 0 plain-text value\(s\) were encrypted and \d+ value\(s\) re-encrypted with the current key version\./);
});

test("T44 a key renamed back after a rotation: the message names the missing version and variable, nothing changes", async () => {
  assert.equal(runApply().status, 0);
  const v2 = randomBytes(32).toString("base64");
  assert.equal(runApply({ SETTINGS_ENCRYPTION_KEY_V2: v2 }).status, 0, "rotated to version 2");
  const before = await snapshot();
  // The natural tidy-up: SETTINGS_ENCRYPTION_KEY_V2 renamed back to SETTINGS_ENCRYPTION_KEY.
  const renamed = { SETTINGS_ENCRYPTION_KEY: v2 };
  for (const args of [[], ["--apply", `--expect-fingerprint=${fingerprintOf(renamed)}`]]) {
    const r = run(args, renamed);
    assert.equal(r.status, 2, r.out);
    assertQuiet(r.out);
    assert.match(r.out, /value\(s\) were encrypted with key version 2, but SETTINGS_ENCRYPTION_KEY_V2 is not set here/);
    assert.match(r.out, /must keep the variable name it had/);
    assert.ok(!/do not decrypt/.test(r.out), "it is not reported as a wrong key");
  }
  assert.deepEqual(await snapshot(), before);
});

test("T44 the list of server-written names matches OAUTH_PENDING_KEY in lib/google-oauth-state.ts", () => {
  const source = readFileSync(path.join(process.env.TEST_REPO_ROOT, "lib", "google-oauth-state.ts"), "utf8");
  const m = /export const OAUTH_PENDING_KEY = "([^"]+)";/.exec(source);
  assert.ok(m, "OAUTH_PENDING_KEY is found");
  assert.deepEqual([...SERVER_WRITTEN_SETTING_KEYS], [m[1]]);
});

test("T44 a server-only name the app does not write is listed, noted, left untouched, and the exit code is unchanged", async () => {
  const odd = "_odd name\nx";
  const [plainRow] = await db()`
    INSERT INTO settings (user_id, key, value) VALUES (${A.id}, '_reiskip_key', ${dummySecret("reserved-plain")}) RETURNING *`;
  const [oddRow] = await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, ${odd}, 'x') RETURNING *`;
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, '_google_oauth_pending', ${"b".repeat(64)})`;
  const quoted = JSON.stringify(odd);
  for (const r of [run(), runApply()]) {
    assert.equal(r.status, 0, r.out);
    assertQuiet(r.out);
    assert.ok(
      r.out.includes(`server-only settings (names starting with _), skipped: 3 (_reiskip_key, ${quoted}, _google_oauth_pending)`),
      r.out
    );
    assert.ok(
      r.out.includes(
        `Note: 2 server-only names are not one this app writes itself: _reiskip_key, ${quoted}. ` +
          "If they hold a key someone saved, they are still plain text. Delete those rows or rename them " +
          "(the app only writes: _google_oauth_pending)."
      ),
      r.out
    );
  }
  assert.deepEqual(await settingRow(plainRow.id), plainRow, "left untouched, still plain text");
  assert.deepEqual(await settingRow(oddRow.id), oddRow);
});

test("T44 a long list of server-only names is cut at 20 names", async () => {
  for (let i = 0; i < 22; i++) {
    await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, ${`_old_${String(i).padStart(2, "0")}`}, 'x')`;
  }
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /skipped: 22 \(_old_00, .*_old_19 and 2 more\)$/m);
  assert.ok(!r.out.includes("_old_20"), "the 21st name is not printed");
  assert.match(r.out, /Note: 22 server-only names are not one this app writes itself: _old_00, .*_old_19 and 2 more\./);
});
