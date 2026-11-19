// T41. Saved settings: secrets are encrypted in the database and never
// returned to the browser. GET gives "set" and the last 4 characters only.
// An empty value keeps what is saved; DELETE clears. Users cannot reach each
// other's secrets, and old plain-text rows keep working without leaking.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import { STORED_FORMAT, dummySecret, decryptSetting, encryptSetting, waitForServerLog } from "./helpers/secrets.mjs";

const A = USERS.A;
const B = USERS.B;
const ADMIN = USERS.ADMIN;

beforeEach(reseed);
after(closeDb);

function getSettings(user, opts = {}) {
  return api("/api/settings", { user, ...opts });
}
function save(user, body, opts = {}) {
  return api("/api/settings", { method: "POST", user, body, ...opts });
}
function clear(user, keys, opts = {}) {
  const q = new URLSearchParams(keys.map((k) => ["key", k]));
  return api(`/api/settings?${q}`, { method: "DELETE", user, ...opts });
}
async function rows(userId, key) {
  return db()`SELECT id, value, updated_at FROM settings WHERE user_id = ${userId} AND key = ${key} ORDER BY id`;
}
async function storedValue(userId, key) {
  const r = await rows(userId, key);
  assert.equal(r.length, 1, `one ${key} row for ${userId}`);
  return r[0].value;
}
function assertNotIn(res, ...values) {
  for (const v of values) assert.ok(!res.text.includes(v), "the response must not contain the secret");
}

test("T41 save: the stored text is encrypted, bound to the user and key, and decrypts", async () => {
  const secret = dummySecret("twilio-auth");
  const res = await save(A, { twilio_auth_token: secret });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { ok: true });
  assertNotIn(res, secret);
  const stored = await storedValue(A.id, "twilio_auth_token");
  assert.match(stored, STORED_FORMAT);
  assert.ok(!stored.includes(secret));
  assert.ok(!stored.includes("ZZSECRET"));
  assert.equal(decryptSetting(A.id, "twilio_auth_token", stored), secret);
  assert.throws(() => decryptSetting(B.id, "twilio_auth_token", stored), "another user's context fails");
  assert.throws(() => decryptSetting(A.id, "reiskip_api_key", stored), "another key's context fails");
});

test("T41 every named key is a secret: saved encrypted, GET shows set and last 4 only", async () => {
  const keys = ["twilio_account_sid", "twilio_auth_token", "reiskip_api_key", "batchskiptracing_api_key", "skipengine_api_key"];
  const body = Object.fromEntries(keys.map((k) => [k, dummySecret(k)]));
  assert.equal((await save(A, body)).status, 200);
  const res = await getSettings(A);
  assert.equal(res.status, 200, res.text);
  assertNotIn(res, ...Object.values(body));
  assert.deepEqual(Object.keys(res.json).sort(), ["secrets", "values"]);
  assert.deepEqual(res.json.values, {});
  for (const k of keys) {
    assert.deepEqual(res.json.secrets[k], { set: true, last4: body[k].slice(-4) }, k);
    assert.match(await storedValue(A.id, k), STORED_FORMAT);
  }
});

test("T41 keep: an empty, white space, null, missing or non-string value keeps what is saved", async () => {
  const secret = dummySecret("keep");
  await save(A, { twilio_auth_token: secret });
  const before = await rows(A.id, "twilio_auth_token");
  for (const body of [{ twilio_auth_token: "" }, { twilio_auth_token: "   \n" }, { twilio_auth_token: null }, {}, { twilio_auth_token: 5 }]) {
    const res = await save(A, body);
    assert.equal(res.status, 200, `${JSON.stringify(body)}: ${res.text}`);
    assert.deepEqual(await rows(A.id, "twilio_auth_token"), before, JSON.stringify(body));
  }
  const res = await getSettings(A);
  assert.deepEqual(res.json.secrets.twilio_auth_token, { set: true, last4: secret.slice(-4) });
});

test("T41 keep: an empty value for a secret that was never saved creates no row", async () => {
  assert.equal((await save(A, { skipengine_api_key: "" })).status, 200);
  assert.equal((await rows(A.id, "skipengine_api_key")).length, 0);
});

test("T41 replace: a new value replaces the old one, and is trimmed", async () => {
  await save(A, { reiskip_api_key: dummySecret("old") });
  const next = dummySecret("new");
  const res = await save(A, { reiskip_api_key: `  ${next}\n` });
  assert.equal(res.status, 200, res.text);
  const r = await rows(A.id, "reiskip_api_key");
  assert.equal(r.length, 1, "still one row");
  assert.equal(decryptSetting(A.id, "reiskip_api_key", r[0].value), next);
  const got = await getSettings(A);
  assert.deepEqual(got.json.secrets.reiskip_api_key, { set: true, last4: next.slice(-4) });
});

test("T41 clear: DELETE removes the row, is safe to repeat and works for several keys", async () => {
  await save(A, { twilio_auth_token: dummySecret("a"), twilio_account_sid: dummySecret("b"), twilio_phone_number: "+15555550100" });
  const res = await clear(A, ["twilio_auth_token"]);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { ok: true });
  assert.equal((await rows(A.id, "twilio_auth_token")).length, 0);
  assert.equal((await rows(A.id, "twilio_account_sid")).length, 1, "other keys stay");
  assert.equal((await clear(A, ["twilio_auth_token"])).status, 200, "repeat is fine");
  assert.equal((await clear(A, ["twilio_account_sid", "twilio_phone_number"])).status, 200);
  const got = await getSettings(A);
  assert.deepEqual(got.json, { values: {}, secrets: {} });
});

test("T41 DELETE without a valid key list is a 400 and deletes nothing", async () => {
  await save(A, { twilio_auth_token: dummySecret("stay") });
  const many = Array.from({ length: 51 }, (_, i) => `key_${i}`);
  for (const path of [
    "/api/settings",
    "/api/settings?key=",
    "/api/settings?other=twilio_auth_token",
    `/api/settings?key=${"k".repeat(101)}`,
    `/api/settings?${new URLSearchParams(many.map((k) => ["key", k]))}`,
    "/api/settings?key=twilio_auth_token&key=",
  ]) {
    const res = await api(path, { method: "DELETE", user: A });
    assert.equal(res.status, 400, `${path.slice(0, 60)}: ${res.status} ${res.text.slice(0, 100)}`);
  }
  assert.equal((await rows(A.id, "twilio_auth_token")).length, 1);
  assert.equal((await clear(A, Array.from({ length: 50 }, (_, i) => `key_${i}`))).status, 200, "50 keys is allowed");
});

test("T41 a short secret shows as set with no last 4", async () => {
  await save(A, { skipengine_api_key: "ZZSECRET-ab" });
  const res = await getSettings(A);
  assert.deepEqual(res.json.secrets.skipengine_api_key, { set: true, last4: null });
  assertNotIn(res, "ZZSECRET");
});

test("T41 the public twilio_phone_number round-trips as before, in plain text", async () => {
  assert.equal((await save(A, { twilio_phone_number: "+15555550123" })).status, 200);
  assert.equal(await storedValue(A.id, "twilio_phone_number"), "+15555550123");
  let res = await getSettings(A);
  assert.deepEqual(res.json, { values: { twilio_phone_number: "+15555550123" }, secrets: {} });
  assert.equal((await save(A, { twilio_phone_number: "" })).status, 200, "an empty public value is saved, as before");
  assert.equal(await storedValue(A.id, "twilio_phone_number"), "");
  res = await getSettings(A);
  assert.deepEqual(res.json.values, { twilio_phone_number: "" });
});

test("T41 a key nobody has defined yet is treated as a secret", async () => {
  const secret = dummySecret("future");
  await save(A, { some_future_api_key: secret });
  const stored = await storedValue(A.id, "some_future_api_key");
  assert.match(stored, STORED_FORMAT);
  const res = await getSettings(A);
  assert.deepEqual(res.json.secrets.some_future_api_key, { set: true, last4: secret.slice(-4) });
  assert.equal(res.json.values.some_future_api_key, undefined);
  assertNotIn(res, secret);
});

test("T41 a value over 10,000 characters is skipped, as before: the old value stays, other names still save", async () => {
  const old = dummySecret("old");
  await save(A, { reiskip_api_key: old, twilio_phone_number: "+15555550180" });
  const long = "ZZSECRET" + "x".repeat(10_000);
  const longPadded = `  ${"ZZSECRET" + "z".repeat(9_993)}  `; // 10,001 after trimming
  const before = await db()`SELECT id, key, value, updated_at FROM settings WHERE user_id = ${A.id} ORDER BY id`;
  for (const body of [
    { reiskip_api_key: long },
    { reiskip_api_key: longPadded },
    { twilio_phone_number: "+1" + "5".repeat(10_000) },
  ]) {
    const res = await save(A, body);
    assert.equal(res.status, 200, `${Object.keys(body)}: ${res.status} ${res.text.slice(0, 100)}`);
    assertNotIn(res, "ZZSECRET");
  }
  assert.deepEqual(
    await db()`SELECT id, key, value, updated_at FROM settings WHERE user_id = ${A.id} ORDER BY id`,
    before,
    "the skipped rows are unchanged"
  );
  // In a mixed request, the other names are still saved.
  const other = dummySecret("other");
  const mixed = await save(A, { reiskip_api_key: long, twilio_auth_token: other, twilio_phone_number: "+15555550181" });
  assert.equal(mixed.status, 200, mixed.text);
  const got = await getSettings(A);
  assert.deepEqual(got.json.secrets.reiskip_api_key, { set: true, last4: old.slice(-4) }, "the old key stays");
  assert.deepEqual(got.json.secrets.twilio_auth_token, { set: true, last4: other.slice(-4) });
  assert.deepEqual(got.json.values, { twilio_phone_number: "+15555550181" });
});

test("T41 a secret of exactly 10,000 characters after trimming is saved", async () => {
  const exact = "ZZSECRET" + "y".repeat(10_000 - 8 - 4) + "0042";
  assert.equal(exact.length, 10_000);
  const res = await save(A, { skipengine_api_key: `   ${exact}   ` });
  assert.equal(res.status, 200, res.text);
  assert.equal(decryptSetting(A.id, "skipengine_api_key", await storedValue(A.id, "skipengine_api_key")), exact);
  const got = await getSettings(A);
  assert.deepEqual(got.json.secrets.skipengine_api_key, { set: true, last4: "0042" });
});

test("T41 isolation: B cannot see A's secret", async () => {
  const secret = dummySecret("a-only");
  await save(A, { twilio_auth_token: secret });
  const res = await getSettings(B);
  assert.equal(res.status, 200);
  assertNotIn(res, secret, secret.slice(-4));
  assert.equal(res.json.secrets.twilio_auth_token, undefined);
});

test("T41 isolation: B cannot replace or delete A's secret", async () => {
  await save(A, { twilio_auth_token: dummySecret("a-keep") });
  const before = await rows(A.id, "twilio_auth_token");
  const hostile = { twilio_auth_token: dummySecret("b-try"), userId: A.id, user_id: A.id };
  assert.equal((await save(B, hostile)).status, 200);
  assert.equal((await clear(B, ["twilio_auth_token"])).status, 200);
  assert.deepEqual(await rows(A.id, "twilio_auth_token"), before);
  assert.equal((await rows(B.id, "twilio_auth_token")).length, 0, "B's own row was created, then cleared by B");
});

test("T41 isolation: an admin impersonating A sees set and last 4 only", async () => {
  const secret = dummySecret("imp");
  await save(A, { twilio_auth_token: secret });
  const cookies = ["x-impersonate-user-id=" + A.id];
  const res = await getSettings(ADMIN, { cookies });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.secrets.twilio_auth_token, { set: true, last4: secret.slice(-4) });
  assertNotIn(res, secret);
});

test("T41 isolation: a value copied in the database from A's row to B's row is unreadable for B", async () => {
  const secret = dummySecret("copied");
  await save(A, { twilio_auth_token: secret });
  const stored = await storedValue(A.id, "twilio_auth_token");
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${B.id}, 'twilio_auth_token', ${stored})`;
  // Also copied to another key of A's own.
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'twilio_account_sid', ${stored})`;
  const b = await getSettings(B);
  assert.equal(b.status, 200, b.text);
  assert.deepEqual(b.json.secrets.twilio_auth_token, { set: true, last4: null, unreadable: true });
  assertNotIn(b, secret);
  const a = await getSettings(A);
  assert.deepEqual(a.json.secrets.twilio_account_sid, { set: true, last4: null, unreadable: true });
  assert.deepEqual(a.json.secrets.twilio_auth_token, { set: true, last4: secret.slice(-4) });
});

test("T41 legacy: B's old plain-text row is set with last 4 and never returned", async () => {
  const res = await getSettings(B);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.secrets.reiskip_api_key, { set: true, last4: "-key" });
  assert.ok(!res.text.includes("ZZVICTIM-fake-key"));
});

test("T41 legacy: a plain-text secret is never returned, and saving replaces it with an encrypted value", async () => {
  const secret = dummySecret("legacy");
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'twilio_auth_token', ${secret})`;
  let res = await getSettings(A);
  assert.deepEqual(res.json.secrets.twilio_auth_token, { set: true, last4: secret.slice(-4) });
  assertNotIn(res, secret);
  const next = dummySecret("legacy-next");
  assert.equal((await save(A, { twilio_auth_token: next })).status, 200);
  const stored = await storedValue(A.id, "twilio_auth_token");
  assert.match(stored, STORED_FORMAT);
  assert.equal(decryptSetting(A.id, "twilio_auth_token", stored), next);
  res = await getSettings(A);
  assertNotIn(res, secret, next);
});

test("T41 legacy: an empty or white space value counts as not set", async () => {
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'twilio_account_sid', ''), (${A.id}, 'skipengine_api_key', '   ')`;
  const res = await getSettings(A);
  assert.deepEqual(res.json.secrets.twilio_account_sid, { set: false, last4: null });
  assert.deepEqual(res.json.secrets.skipengine_api_key, { set: false, last4: null });
});

test("T41 a row encrypted by the test with the run's key reads back through the app", async () => {
  const secret = dummySecret("seeded");
  const stored = encryptSetting(A.id, "batchskiptracing_api_key", secret);
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'batchskiptracing_api_key', ${stored})`;
  const res = await getSettings(A);
  assert.deepEqual(res.json.secrets.batchskiptracing_api_key, { set: true, last4: secret.slice(-4) });
});

test("T41 signed out: GET, POST and DELETE answer 401", async () => {
  assert.equal((await api("/api/settings")).status, 401);
  assert.equal((await api("/api/settings", { method: "POST", body: { reiskip_api_key: dummySecret() } })).status, 401);
  assert.equal((await api("/api/settings?key=reiskip_api_key", { method: "DELETE" })).status, 401);
});

test("T41 a setting named constructor is an ordinary secret key", async () => {
  await save(A, { twilio_phone_number: "+15555550160" });
  const before = await db()`SELECT id, user_id, key, value, updated_at FROM settings ORDER BY id`;
  const ctor = dummySecret("ctor");
  const res = await save(A, { constructor: ctor });
  assert.equal(res.status, 200, res.text);
  assert.equal(decryptSetting(A.id, "constructor", await storedValue(A.id, "constructor")), ctor);
  const after = await db()`SELECT id, user_id, key, value, updated_at FROM settings WHERE key <> 'constructor' ORDER BY id`;
  assert.deepEqual(after, before, "no other row changed");
  const got = await getSettings(A);
  assert.equal(got.status, 200, got.text);
  assertNotIn(got, ctor);
  assert.deepEqual(Object.keys(got.json.secrets), ["constructor"]);
  assert.deepEqual(got.json.secrets.constructor, { set: true, last4: ctor.slice(-4) });
  assert.deepEqual(got.json.values, { twilio_phone_number: "+15555550160" });
});

test("T41 POST with a reserved name (starting with _), including __proto__, is a 400 and writes nothing", async () => {
  const before = await db()`SELECT id, user_id, key, value, updated_at FROM settings ORDER BY id`;
  const bodies = [
    // Raw JSON, so "__proto__" is a real key of the body (zod's record output would drop it).
    `{"__proto__": ${JSON.stringify(dummySecret("proto"))}}`,
    `{"reiskip_api_key": ${JSON.stringify(dummySecret("ok"))}, "__proto__": "x"}`,
    { _google_oauth_pending: "0".repeat(64) },
    { twilio_phone_number: "+15555550161", _anything: "x" },
  ];
  for (const body of bodies) {
    const res = await save(A, body);
    assert.equal(res.status, 400, `${typeof body === "string" ? body.slice(0, 40) : Object.keys(body)}: ${res.status} ${res.text}`);
  }
  assert.deepEqual(await db()`SELECT id, user_id, key, value, updated_at FROM settings ORDER BY id`, before);
});

test("T41 DELETE with a reserved name is a 400 and the connect marker stays", async () => {
  const connect = await api("/api/calendar/google?action=connect", { user: A });
  assert.ok([302, 303, 307, 308].includes(connect.status), connect.text.slice(0, 200));
  const marker = await rows(A.id, "_google_oauth_pending");
  assert.equal(marker.length, 1, "connect stored the marker");
  for (const keys of [["_google_oauth_pending"], ["twilio_auth_token", "_google_oauth_pending"], ["__proto__"]]) {
    const res = await clear(A, keys);
    assert.equal(res.status, 400, `${keys}: ${res.status} ${res.text}`);
  }
  assert.deepEqual(await rows(A.id, "_google_oauth_pending"), marker);
});

test("T41 GET never shows the connect marker after a connect has started", async () => {
  await save(A, { twilio_phone_number: "+15555550162", reiskip_api_key: dummySecret("x") });
  await api("/api/calendar/google?action=connect", { user: A });
  assert.equal((await rows(A.id, "_google_oauth_pending")).length, 1);
  const res = await getSettings(A);
  assert.equal(res.status, 200, res.text);
  assert.ok(!res.text.includes("_google_oauth_pending"), res.text);
  assert.deepEqual(Object.keys(res.json.values), ["twilio_phone_number"]);
  assert.deepEqual(Object.keys(res.json.secrets), ["reiskip_api_key"]);
});

// Old rows can have names the save rule now refuses. They are seeded with SQL.
const ODD_NAMES = ["old key with space", "line\nbreak key", "slash/key"];

test("T41 old rows with odd names still show correctly in GET", async () => {
  const values = {};
  for (const name of ODD_NAMES) {
    values[name] = dummySecret("odd");
    await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, ${name}, ${encryptSetting(A.id, name, values[name])})`;
  }
  const legacy = dummySecret("odd-legacy");
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'legacy name;x', ${legacy})`;
  const res = await getSettings(A);
  assert.equal(res.status, 200, res.text);
  assertNotIn(res, legacy, ...Object.values(values));
  for (const name of ODD_NAMES) {
    assert.deepEqual(res.json.secrets[name], { set: true, last4: values[name].slice(-4) }, JSON.stringify(name));
  }
  assert.deepEqual(res.json.secrets["legacy name;x"], { set: true, last4: legacy.slice(-4) });
});

test("T41 an odd name in a log line stays on one line", async () => {
  // A value that does not decrypt for this name, so GET logs one line naming it.
  const name = "forged\nSaved setting could not be read: user someone-else";
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, ${name}, ${encryptSetting(B.id, name, dummySecret("x"))})`;
  const res = await getSettings(A);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.secrets[name], { set: true, last4: null, unreadable: true });
  const expected = `Saved setting could not be read: user ${A.id}, key ${JSON.stringify(name)}.`;
  const log = await waitForServerLog("app", expected);
  assert.ok(log.includes(expected), "the name is written quoted, on one line");
  assert.ok(!log.split("\n").some((l) => l.startsWith("Saved setting could not be read: user someone-else")), "no forged line");
});

test("T41 DELETE with a name outside the name rule is a 400 and deletes nothing", async () => {
  for (const name of ODD_NAMES) {
    await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, ${name}, ${encryptSetting(A.id, name, dummySecret("del"))})`;
  }
  await save(A, { twilio_auth_token: dummySecret("stay") });
  const before = await db()`SELECT id, key, value FROM settings WHERE user_id = ${A.id} ORDER BY id`;
  for (const keys of [[ODD_NAMES[0]], [ODD_NAMES[1]], ["twilio_auth_token", ODD_NAMES[2]], ["naïve"]]) {
    const res = await clear(A, keys);
    assert.equal(res.status, 400, `${JSON.stringify(keys)}: ${res.status}`);
  }
  assert.deepEqual(await db()`SELECT id, key, value FROM settings WHERE user_id = ${A.id} ORDER BY id`, before);
});

test("T41 51 names in one POST is a 400, and nothing is saved or encrypted", async () => {
  const before = await db()`SELECT id FROM settings WHERE user_id = ${A.id}`;
  const body = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`key_${i}`, dummySecret(`k${i}`)]));
  const res = await save(A, body);
  assert.equal(res.status, 400, res.text);
  assertNotIn(res, "ZZSECRET");
  assert.deepEqual(await db()`SELECT id FROM settings WHERE user_id = ${A.id}`, before);
});
