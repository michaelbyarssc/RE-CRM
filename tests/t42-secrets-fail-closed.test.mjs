// T42. Fail closed: on the app server that has no SETTINGS_ENCRYPTION_KEY,
// nothing secret is ever stored in plain text. Saving a secret is a 503 with
// a clear message and writes nothing; public settings and reading still work.
// Google Calendar refuses to connect before it contacts Google.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import { dummySecret, encryptSetting, encryptTokenValue, outboundCalls, clearOutboundCalls } from "./helpers/secrets.mjs";
import { mintState, findSetCookie, NONCE_COOKIE } from "./helpers/oauth.mjs";

const NOKEY = process.env.TEST_NOKEY_URL;
const A = USERS.A;
const B = USERS.B;

beforeEach(reseed);
after(closeDb);

function nokey(path, opts = {}) {
  if (!NOKEY) throw new Error("TEST_NOKEY_URL is not set: run the tests with npm test");
  return api(path, { base: NOKEY, ...opts });
}
async function settingsSnapshot() {
  return db()`SELECT id, user_id, key, value, updated_at FROM settings ORDER BY id`;
}
function assertClearMessage(res) {
  assert.equal(res.status, 503, `${res.status} ${res.text.slice(0, 200)}`);
  assert.equal(typeof res.json?.error, "string");
  assert.match(res.json.error, /SETTINGS_ENCRYPTION_KEY/);
  assert.match(res.json.error, /cannot be saved/);
}

test("T42 saving a secret without the key: 503 with a clear message, and the database is unchanged", async () => {
  const before = await settingsSnapshot();
  const secret = dummySecret("nokey");
  const res = await nokey("/api/settings", { method: "POST", user: A, body: { twilio_auth_token: secret } });
  assertClearMessage(res);
  assert.ok(!res.text.includes(secret));
  assert.deepEqual(await settingsSnapshot(), before);
});

test("T42 replacing an existing secret without the key: 503 and the old value stays", async () => {
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'reiskip_api_key', ${encryptSetting(A.id, "reiskip_api_key", dummySecret("old"))})`;
  const before = await settingsSnapshot();
  const res = await nokey("/api/settings", { method: "POST", user: A, body: { reiskip_api_key: dummySecret("new") } });
  assertClearMessage(res);
  assert.deepEqual(await settingsSnapshot(), before);
});

test("T42 a mixed request (public and secret) writes nothing", async () => {
  const before = await settingsSnapshot();
  const res = await nokey("/api/settings", {
    method: "POST",
    user: A,
    body: { twilio_phone_number: "+15555550111", twilio_auth_token: dummySecret("mixed") },
  });
  assertClearMessage(res);
  assert.deepEqual(await settingsSnapshot(), before);
});

test("T42 a public-only save works without the key, and so does an empty secret (keep)", async () => {
  const res = await nokey("/api/settings", {
    method: "POST",
    user: A,
    body: { twilio_phone_number: "+15555550112", twilio_auth_token: "" },
  });
  assert.equal(res.status, 200, res.text);
  const rows = await db()`SELECT key, value FROM settings WHERE user_id = ${A.id} ORDER BY key`;
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [["twilio_phone_number", "+15555550112"]]);
});

test("T42 GET works without the key: public values, legacy rows, and encrypted rows as saved (not unreadable)", async () => {
  const secret = dummySecret("enc");
  await db()`INSERT INTO settings (user_id, key, value) VALUES
    (${A.id}, 'twilio_phone_number', '+15555550113'),
    (${A.id}, 'twilio_auth_token', ${encryptSetting(A.id, "twilio_auth_token", secret)})`;
  const a = await nokey("/api/settings", { user: A });
  assert.equal(a.status, 200, a.text);
  assert.deepEqual(a.json, {
    values: { twilio_phone_number: "+15555550113" },
    secrets: { twilio_auth_token: { set: true, last4: null } },
  });
  const b = await nokey("/api/settings", { user: B });
  assert.equal(b.status, 200, b.text);
  assert.deepEqual(b.json.secrets.reiskip_api_key, { set: true, last4: "-key" });
  assert.ok(!b.text.includes("ZZVICTIM-fake-key"));
});

test("T42 clearing a secret works without the key", async () => {
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'twilio_auth_token', ${encryptSetting(A.id, "twilio_auth_token", dummySecret("del"))})`;
  const res = await nokey("/api/settings?key=twilio_auth_token", { method: "DELETE", user: A });
  assert.equal(res.status, 200, res.text);
  const rows = await db()`SELECT id FROM settings WHERE user_id = ${A.id}`;
  assert.equal(rows.length, 0);
});

// Google Calendar on the server without the key.

const CALLBACK = "/api/calendar/google/callback";

function googleCalls() {
  return outboundCalls().filter((c) => /google/.test(new URL(c.url).hostname));
}

test("T42 Google connect without the key goes back to the settings page and starts no flow", async () => {
  clearOutboundCalls();
  const res = await nokey("/api/calendar/google?action=connect", { user: A });
  assert.ok([302, 303, 307, 308].includes(res.status), `${res.status} ${res.text.slice(0, 200)}`);
  const loc = new URL(res.location);
  assert.equal(loc.origin, new URL(process.env.TEST_APP_URL).origin, "same base URL as the callback");
  assert.equal(loc.pathname, "/settings");
  assert.equal(loc.searchParams.get("google_error"), "encryption_not_configured");
  assert.equal(loc.searchParams.get("state"), null);
  assert.equal(findSetCookie(res.setCookies, NONCE_COOKIE), null, "no nonce cookie: no flow is started");
  assert.deepEqual(googleCalls(), []);
  const markers = await db()`SELECT id FROM settings WHERE key = '_google_oauth_pending'`;
  assert.equal(markers.length, 0, "no pending marker row is created");
});

test("T42 the callback with a valid state refuses before any call to Google", async () => {
  clearOutboundCalls();
  const minted = mintState({ userId: A.id });
  // A real connect stores this pending marker on the server (see T18).
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, '_google_oauth_pending', ${minted.payload.nh})`;
  const res = await nokey(`${CALLBACK}?${new URLSearchParams({ code: "fake-code", state: minted.state })}`, {
    user: A,
    cookies: [`${NONCE_COOKIE}=${minted.nonce}`],
  });
  assert.ok([302, 303, 307, 308].includes(res.status), `${res.status} ${res.text.slice(0, 200)}`);
  const loc = new URL(res.location);
  assert.equal(loc.pathname, "/settings");
  assert.equal(loc.searchParams.get("google_error"), "encryption_not_configured");
  assert.ok(findSetCookie(res.setCookies, NONCE_COOKIE), "the nonce cookie is cleared");
  assert.deepEqual(googleCalls(), [], "Google was not contacted, so the code is not spent");
  const [r] = await db()`SELECT count(*)::int AS n FROM google_calendar_tokens`;
  assert.equal(r.n, 0);
  const markers = await db()`SELECT id FROM settings WHERE key = '_google_oauth_pending'`;
  assert.equal(markers.length, 0, "the state was used up before the key check");
});

test("T42 the state check still comes first without the key", async () => {
  clearOutboundCalls();
  const res = await nokey(`${CALLBACK}?code=fake&state=garbage`, { user: A });
  assert.equal(new URL(res.location).searchParams.get("google_error"), "invalid_state");
});

test("T42 reading a saved Google token without the key is a 503, and Google is not called", async () => {
  clearOutboundCalls();
  await db()`
    INSERT INTO google_calendar_tokens (user_id, access_token, refresh_token, expires_at, calendar_id, sync_enabled)
    VALUES (${A.id}, ${encryptTokenValue(A.id, "access_token", dummySecret("nk-a"))},
            ${encryptTokenValue(A.id, "refresh_token", dummySecret("nk-r"))},
            ${new Date(Date.now() + 3600_000).toISOString()}, 'primary', 1)`;
  const status = await nokey("/api/calendar/google", { user: A });
  assert.equal(status.status, 503, status.text);
  assert.match(status.json.error, /SETTINGS_ENCRYPTION_KEY/);
  const sync = await nokey("/api/calendar/google/sync", { method: "POST", user: A, body: {} });
  assert.equal(sync.status, 503, sync.text);
  assert.deepEqual(googleCalls(), []);
  const none = await nokey("/api/calendar/google", { user: B });
  assert.equal(none.status, 200, "a user with no token row is simply not connected");
  assert.equal(none.json.connected, false);
});

test("T42 the same encrypted row: saved without the key, unreadable only for a real decrypt failure", async () => {
  const stored = encryptSetting(A.id, "twilio_auth_token", dummySecret("pair"));
  await db()`INSERT INTO settings (user_id, key, value) VALUES (${A.id}, 'twilio_auth_token', ${stored}), (${B.id}, 'twilio_auth_token', ${stored})`;
  // No key on this server: the value may be fine, so it is only "saved".
  for (const user of [A, B]) {
    const res = await nokey("/api/settings", { user });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json.secrets.twilio_auth_token, { set: true, last4: null }, user.email);
  }
  // With the key: A's row reads; the copy in B's row does not decrypt.
  const b = await api("/api/settings", { user: B });
  assert.deepEqual(b.json.secrets.twilio_auth_token, { set: true, last4: null, unreadable: true });
  const a = await api("/api/settings", { user: A });
  assert.equal(a.json.secrets.twilio_auth_token.set, true);
  assert.equal(a.json.secrets.twilio_auth_token.unreadable, undefined);
});
