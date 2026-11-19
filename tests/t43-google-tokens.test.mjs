// T43. Google Calendar tokens are stored encrypted and still work.
//
// The suite blocks outbound calls, so these tests go up to the call to
// Google: the network guard logs the SHA-256 of the Authorization header and
// of each JSON body value, and the tests compare them with the hash of the
// token they seeded. The token endpoint answers from a local stand-in only
// while a test switches it on.

import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import { nonceFromSetCookies, NONCE_COOKIE } from "./helpers/oauth.mjs";
import {
  STORED_FORMAT,
  dummySecret,
  encryptTokenValue,
  decryptTokenValue,
  sha256,
  outboundCalls,
  clearOutboundCalls,
  googleStubOn,
  googleStubOff,
  testKey,
  testRing,
  waitForServerLog,
} from "./helpers/secrets.mjs";
import { currentFingerprint, keyRingFromEnv, encrypt } from "../lib/secrets/box.mjs";
import { settingContext, tokenContext } from "../lib/secrets/policy.mjs";
import { randomBytes } from "node:crypto";

const A = USERS.A;
const B = USERS.B;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FUTURE = () => new Date(Date.now() + 3600_000).toISOString();
const PAST = "2000-01-01T00:00:00.000Z";

beforeEach(async () => {
  await reseed();
  clearOutboundCalls();
  googleStubOff();
});
afterEach(googleStubOff);
after(closeDb);

async function seedTokens(userId, { access, refresh, expiresAt = FUTURE(), encrypted = true }) {
  const a = encrypted ? encryptTokenValue(userId, "access_token", access) : access;
  const r = encrypted ? encryptTokenValue(userId, "refresh_token", refresh) : refresh;
  const [row] = await db()`
    INSERT INTO google_calendar_tokens (user_id, access_token, refresh_token, expires_at, calendar_id, sync_enabled)
    VALUES (${userId}, ${a}, ${r}, ${expiresAt}, 'primary', 1) RETURNING id`;
  return row.id;
}
async function tokenRow(userId) {
  const rows = await db()`SELECT * FROM google_calendar_tokens WHERE user_id = ${userId} ORDER BY id`;
  assert.ok(rows.length <= 1, "at most one token row per user");
  return rows[0];
}
function calendarCalls() {
  return outboundCalls().filter((c) => new URL(c.url).hostname === "www.googleapis.com");
}
function tokenCalls() {
  return outboundCalls().filter((c) => c.url === TOKEN_URL);
}
function assertNoToken(res, ...tokens) {
  assert.ok(!res.text.includes("ZZSECRET"), "no dummy secret in the response");
  assert.ok(!res.text.includes("enc:v"), "no stored token text in the response");
  for (const t of tokens) assert.ok(!res.text.includes(t));
}
function sync(user) {
  return api("/api/calendar/google/sync", { method: "POST", user, body: {} });
}

test("T43 sync with an encrypted, unexpired token reaches Google with the right bearer token", async () => {
  const access = dummySecret("access");
  const refresh = dummySecret("refresh");
  await seedTokens(A.id, { access, refresh });
  const res = await sync(A);
  assert.equal(res.status, 200, res.text);
  assertNoToken(res, access, refresh);
  const calls = calendarCalls();
  assert.ok(calls.length >= 1, "at least one (blocked) call to the Google Calendar API");
  for (const c of calls) assert.equal(c.authHash, sha256(`Bearer ${access}`), c.url);
  assert.deepEqual(tokenCalls(), [], "no refresh for an unexpired token");
});

test("T43 sync with an expired token refreshes with the saved refresh token and stores the new one encrypted", async () => {
  const access = dummySecret("old-access");
  const refresh = dummySecret("refresh");
  const fresh = dummySecret("new-access");
  await seedTokens(A.id, { access, refresh, expiresAt: PAST });
  const before = await tokenRow(A.id);
  googleStubOn({ refresh_token: { access_token: fresh, expires_in: 3600, token_type: "Bearer" } });

  const res = await sync(A);
  assert.equal(res.status, 200, res.text);
  assertNoToken(res, access, refresh, fresh);

  const [refreshCall, ...more] = tokenCalls();
  assert.equal(more.length, 0, "one refresh request");
  assert.equal(refreshCall.stubbed, true);
  assert.equal(refreshCall.bodyHashes.refresh_token, sha256(refresh), "the saved refresh token was sent");
  assert.equal(refreshCall.bodyHashes.grant_type, sha256("refresh_token"));

  const row = await tokenRow(A.id);
  assert.match(row.access_token, STORED_FORMAT);
  assert.equal(decryptTokenValue(A.id, "access_token", row.access_token), fresh);
  assert.equal(row.refresh_token, before.refresh_token, "the encrypted refresh token is unchanged");
  assert.ok(new Date(row.expires_at).getTime() > Date.now(), "new expiry in the future");
  for (const c of calendarCalls()) assert.equal(c.authHash, sha256(`Bearer ${fresh}`), "the new token is used");
});

test("T43 a failed refresh means not connected, and the row is unchanged", async () => {
  await seedTokens(A.id, { access: dummySecret("a"), refresh: dummySecret("r"), expiresAt: PAST });
  const before = await tokenRow(A.id);
  const res = await sync(A);
  assert.equal(res.status, 400, res.text);
  assert.deepEqual(await tokenRow(A.id), before);
  assert.deepEqual(calendarCalls(), []);
});

test("T43 the callback with a valid state stores BOTH tokens encrypted, bound to that user", async () => {
  const connect = await api("/api/calendar/google?action=connect", { user: A });
  assert.ok([302, 303, 307, 308].includes(connect.status), connect.text.slice(0, 200));
  const state = new URL(connect.location).searchParams.get("state");
  const nonce = nonceFromSetCookies(connect.setCookies);
  const [marker] = await db()`SELECT value FROM settings WHERE user_id = ${A.id} AND key = '_google_oauth_pending'`;
  assert.match(marker.value, /^[0-9a-f]{64}$/, "connect stored the plain-text marker");
  const access = dummySecret("cb-access");
  const refresh = dummySecret("cb-refresh");
  googleStubOn({ authorization_code: { access_token: access, refresh_token: refresh, expires_in: 3599, token_type: "Bearer" } });

  const res = await api(`/api/calendar/google/callback?${new URLSearchParams({ code: "fake-code", state })}`, {
    user: A,
    cookies: [`${NONCE_COOKIE}=${nonce}`],
  });
  assert.ok([302, 303, 307, 308].includes(res.status), `${res.status} ${res.text.slice(0, 200)}`);
  assert.equal(new URL(res.location).searchParams.get("google_success"), "true");
  assertNoToken(res, access, refresh);

  const [call] = tokenCalls();
  assert.equal(call.bodyHashes.code, sha256("fake-code"));
  assert.equal(call.bodyHashes.grant_type, sha256("authorization_code"));

  const row = await tokenRow(A.id);
  assert.match(row.access_token, STORED_FORMAT);
  assert.match(row.refresh_token, STORED_FORMAT);
  assert.ok(!row.access_token.includes(access) && !row.refresh_token.includes(refresh));
  assert.equal(decryptTokenValue(A.id, "access_token", row.access_token), access);
  assert.equal(decryptTokenValue(A.id, "refresh_token", row.refresh_token), refresh);
  assert.throws(() => decryptTokenValue(B.id, "access_token", row.access_token), "bound to A");
  assert.throws(() => decryptTokenValue(A.id, "refresh_token", row.access_token), "bound to the column");
  const markers = await db()`SELECT id FROM settings WHERE user_id = ${A.id} AND key = '_google_oauth_pending'`;
  assert.equal(markers.length, 0, "the pending marker is gone after the callback");

  const status = await api("/api/calendar/google", { user: A });
  assert.equal(status.status, 200);
  assert.equal(status.json.connected, true);
  assertNoToken(status, access, refresh);
});

test("T43 the callback refuses an answer without both tokens and stores nothing", async () => {
  const connect = await api("/api/calendar/google?action=connect", { user: A });
  const state = new URL(connect.location).searchParams.get("state");
  const nonce = nonceFromSetCookies(connect.setCookies);
  googleStubOn({ authorization_code: { access_token: dummySecret("only-access"), expires_in: 3599 } });
  const res = await api(`/api/calendar/google/callback?${new URLSearchParams({ code: "fake-code", state })}`, {
    user: A,
    cookies: [`${NONCE_COOKIE}=${nonce}`],
  });
  assert.equal(new URL(res.location).searchParams.get("google_error"), "token_exchange_failed");
  assert.equal(await tokenRow(A.id), undefined);
});

test("T43 a legacy plain-text token row still works, unchanged while it is valid", async () => {
  const access = dummySecret("legacy-access");
  const refresh = dummySecret("legacy-refresh");
  await seedTokens(A.id, { access, refresh, encrypted: false });
  const before = await tokenRow(A.id);
  const res = await sync(A);
  assert.equal(res.status, 200, res.text);
  assertNoToken(res, access, refresh);
  const calls = calendarCalls();
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.equal(c.authHash, sha256(`Bearer ${access}`));
  const row = await tokenRow(A.id);
  assert.equal(row.access_token, before.access_token);
  assert.equal(row.refresh_token, before.refresh_token);
});

test("T43 a legacy plain-text token row is encrypted (both columns) on refresh", async () => {
  const access = dummySecret("legacy-old");
  const refresh = dummySecret("legacy-refresh");
  const fresh = dummySecret("legacy-new");
  await seedTokens(A.id, { access, refresh, encrypted: false, expiresAt: PAST });
  googleStubOn({ refresh_token: { access_token: fresh, expires_in: 3600 } });
  const res = await sync(A);
  assert.equal(res.status, 200, res.text);
  assert.equal(tokenCalls()[0].bodyHashes.refresh_token, sha256(refresh));
  const row = await tokenRow(A.id);
  assert.match(row.access_token, STORED_FORMAT);
  assert.match(row.refresh_token, STORED_FORMAT);
  assert.equal(decryptTokenValue(A.id, "access_token", row.access_token), fresh);
  assert.equal(decryptTokenValue(A.id, "refresh_token", row.refresh_token), refresh);
});

test("T43 a token row copied to another user is treated as not connected", async () => {
  const access = dummySecret("a-access");
  await seedTokens(A.id, { access, refresh: dummySecret("a-refresh") });
  const a = await tokenRow(A.id);
  await db()`
    INSERT INTO google_calendar_tokens (user_id, access_token, refresh_token, expires_at, calendar_id, sync_enabled)
    VALUES (${B.id}, ${a.access_token}, ${a.refresh_token}, ${a.expires_at}, 'primary', 1)`;
  const status = await api("/api/calendar/google", { user: B });
  assert.equal(status.status, 200, status.text);
  assert.equal(status.json.connected, false);
  assertNoToken(status, access);
  const res = await sync(B);
  assert.equal(res.status, 400, res.text);
  assert.deepEqual(calendarCalls(), [], "B never calls Google with A's token");
});

test("T43 a tampered token row is treated as not connected", async () => {
  await seedTokens(A.id, { access: dummySecret("t-access"), refresh: dummySecret("t-refresh") });
  const row = await tokenRow(A.id);
  const parts = row.access_token.split(":");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
  await db()`UPDATE google_calendar_tokens SET access_token = ${parts.join(":")} WHERE id = ${row.id}`;
  const status = await api("/api/calendar/google", { user: A });
  assert.equal(status.status, 200);
  assert.equal(status.json.connected, false);
  assert.deepEqual(calendarCalls(), []);
});

test("T43 GET /api/calendar/google never contains a token", async () => {
  const access = dummySecret("status-access");
  const refresh = dummySecret("status-refresh");
  await seedTokens(A.id, { access, refresh });
  const res = await api("/api/calendar/google", { user: A });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(Object.keys(res.json).sort(), ["calendarId", "connected", "lastSyncAt", "syncEnabled"]);
  assert.equal(res.json.connected, true);
  assertNoToken(res, access, refresh);
});

test("T43 the admin debug answer shows the key fingerprint, never the key", async () => {
  const res = await api("/api/calendar/google?action=debug", { user: USERS.ADMIN });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.settingsKey, {
    configured: true,
    version: 1,
    fingerprint: currentFingerprint(testRing()),
    problem: null,
    // No saved value has asked for a version this server lacks yet (see the last tests).
    missingKeyVersions: [],
  });
  assert.ok(!res.text.includes(process.env.TEST_SETTINGS_ENCRYPTION_KEY));
  const user = await api("/api/calendar/google?action=debug", { user: A });
  assert.equal(user.status, 403);
  const nokey = await api("/api/calendar/google?action=debug", { user: USERS.ADMIN, base: process.env.TEST_NOKEY_URL });
  assert.equal(nokey.status, 200, nokey.text);
  assert.deepEqual(nokey.json.settingsKey, {
    configured: false,
    version: null,
    fingerprint: null,
    problem: "SETTINGS_ENCRYPTION_KEY is missing",
    missingKeyVersions: [],
  });
});

test("T43 a refused refresh logs Google's short error code (one line, no token), and means not connected", async () => {
  await seedTokens(A.id, { access: dummySecret("rf-a"), refresh: dummySecret("rf-r"), expiresAt: PAST });
  googleStubOn({}); // every grant gets 400 {"error": "invalid_grant"}
  const res = await sync(A);
  assert.equal(res.status, 400, res.text);
  assert.equal(tokenCalls()[0].stubbed, true);
  const line = `Google token refresh failed: user ${A.id}, status 400, code invalid_grant.`;
  const log = await waitForServerLog("app", line);
  assert.ok(log.includes(line), "the app log carries the status and Google's code");
});

test("T43 a refused code exchange logs Google's short error code", async () => {
  const connect = await api("/api/calendar/google?action=connect", { user: A });
  const state = new URL(connect.location).searchParams.get("state");
  const nonce = nonceFromSetCookies(connect.setCookies);
  googleStubOn({});
  const res = await api(`/api/calendar/google/callback?${new URLSearchParams({ code: "fake-code", state })}`, {
    user: A,
    cookies: [`${NONCE_COOKIE}=${nonce}`],
  });
  assert.equal(new URL(res.location).searchParams.get("google_error"), "token_exchange_failed");
  const line = `Google Calendar connect failed: user ${A.id}, status 400, code invalid_grant.`;
  const log = await waitForServerLog("app", line);
  assert.ok(log.includes(line), "the app log carries the status and Google's code");
  assert.equal(await tokenRow(A.id), undefined);
});

// Values saved with key version 2, while this server only has version 1 (as
// after SETTINGS_ENCRYPTION_KEY_V2 was renamed back): the value may be fine,
// so it is "saved", not "unreadable", and the debug answer names the version.
test("T43 a value saved with a key version this server lacks is saved, not unreadable, and the version is reported", async () => {
  const v2 = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: testKey(), SETTINGS_ENCRYPTION_KEY_V2: randomBytes(32).toString("base64") });
  assert.equal(v2.current, 2);
  await db()`INSERT INTO settings (user_id, key, value) VALUES
    (${A.id}, 'twilio_auth_token', ${encrypt(v2, dummySecret("v2-setting"), settingContext(A.id, "twilio_auth_token"))}),
    (${A.id}, 'reiskip_api_key', ${v1ValueThatDoesNotDecrypt(A.id)})`;
  await db()`
    INSERT INTO google_calendar_tokens (user_id, access_token, refresh_token, expires_at, calendar_id, sync_enabled)
    VALUES (${A.id}, ${encrypt(v2, dummySecret("v2-a"), tokenContext(A.id, "access_token"))},
            ${encrypt(v2, dummySecret("v2-r"), tokenContext(A.id, "refresh_token"))}, ${FUTURE()}, 'primary', 1)`;

  const settingsRes = await api("/api/settings", { user: A });
  assert.equal(settingsRes.status, 200, settingsRes.text);
  assert.deepEqual(settingsRes.json.secrets.twilio_auth_token, { set: true, last4: null }, "version 2: saved, not unreadable");
  assert.deepEqual(settingsRes.json.secrets.reiskip_api_key, { set: true, last4: null, unreadable: true }, "version 1 that does not decrypt");

  const status = await api("/api/calendar/google", { user: A });
  assert.equal(status.status, 200, status.text);
  assert.equal(status.json.connected, false, "Google: treated as not connected");
  assert.deepEqual(calendarCalls(), []);

  const line = "Saved values use key version 2, but SETTINGS_ENCRYPTION_KEY_V2 is not set on this server.";
  const log = await waitForServerLog("app", line);
  assert.ok(log.includes(line), "the log names the missing variable");
  assert.equal(log.split(line).length - 1, 1, "logged once per version");

  const debug = await api("/api/calendar/google?action=debug", { user: USERS.ADMIN });
  assert.deepEqual(debug.json.settingsKey.missingKeyVersions, [2]);
  assert.equal(debug.json.settingsKey.configured, true);
});

/** A version 1 value bound to another user's context: version 1 is configured, but it does not decrypt for A. */
function v1ValueThatDoesNotDecrypt(userId) {
  return encrypt(testRing(), dummySecret("v1-other"), settingContext(`${userId}-other`, "reiskip_api_key"));
}
