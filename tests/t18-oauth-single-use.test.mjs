// T18. A Google OAuth state can be used once, on the server, whatever the
// browser does with the nonce cookie (review finding F-OAUTH-REPLAY).
// Also: setting names that start with "_" are reserved for the server.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import { nonceFromSetCookies, NONCE_COOKIE } from "./helpers/oauth.mjs";

const NETWORK_LOG = process.env.TEST_NETWORK_LOG;
const A = USERS.A;
const CALLBACK = "/api/calendar/google/callback";
const PENDING_KEY = "_google_oauth_pending";

beforeEach(async () => {
  await reseed();
  writeFileSync(NETWORK_LOG, "");
});
after(closeDb);

function googleCalls() {
  return readFileSync(NETWORK_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => /google/.test(new URL(c.url).hostname));
}
async function tokenRows() {
  const [r] = await db()`SELECT count(*)::int AS n FROM google_calendar_tokens`;
  return r.n;
}
async function pendingRows(userId = A.id) {
  return db()`SELECT value FROM settings WHERE user_id = ${userId} AND key = ${PENDING_KEY}`;
}
async function connect(user) {
  const res = await api("/api/calendar/google?action=connect", { user });
  assert.ok([302, 303, 307, 308].includes(res.status), `connect: ${res.status} ${res.text.slice(0, 200)}`);
  const loc = new URL(res.location);
  return { state: loc.searchParams.get("state"), nonce: nonceFromSetCookies(res.setCookies) };
}
function callback(user, query, nonce) {
  return api(`${CALLBACK}?${new URLSearchParams(query)}`, { user, cookies: [`${NONCE_COOKIE}=${nonce}`] });
}
function googleError(res) {
  assert.ok([302, 303, 307, 308].includes(res.status), `callback: ${res.status} ${res.text.slice(0, 200)}`);
  return new URL(res.location).searchParams.get("google_error");
}

test("T18 connect stores exactly one pending marker for the user on the server", async () => {
  await connect(A);
  await connect(A);
  const rows = await pendingRows();
  assert.equal(rows.length, 1, "a new flow replaces the old marker");
  assert.match(rows[0].value, /^[0-9a-f]{64}$/, "the marker is the nonce hash");
});

test("T18 the same state and nonce cookie sent twice: the second is invalid_state and never reaches Google", async () => {
  const { state, nonce } = await connect(A);
  const first = await callback(A, { code: "c1", state }, nonce);
  assert.equal(googleError(first), "token_exchange_failed", "first use gets past the state check");
  assert.equal(googleCalls().length, 1, "first use tries Google once");

  writeFileSync(NETWORK_LOG, "");
  const second = await callback(A, { code: "c2", state }, nonce);
  assert.equal(googleError(second), "invalid_state");
  assert.deepEqual(googleCalls(), [], "replay makes no outbound call");
  assert.equal(await tokenRows(), 0, "replay writes nothing");
  assert.equal((await pendingRows()).length, 0, "marker is gone");
});

test("T18 starting a second connect invalidates the first state", async () => {
  const first = await connect(A);
  const second = await connect(A);
  const old = await callback(A, { code: "c1", state: first.state }, first.nonce);
  assert.equal(googleError(old), "invalid_state", "the older flow no longer works");
  assert.deepEqual(googleCalls(), []);
  const current = await callback(A, { code: "c2", state: second.state }, second.nonce);
  assert.equal(googleError(current), "token_exchange_failed", "the newest flow still works");
});

test("T18 the marker is used up by the first callback even when Google answered with an error or no code", async () => {
  for (const firstQuery of [{ error: "access_denied" }, {}]) {
    const { state, nonce } = await connect(A);
    const first = await callback(A, { ...firstQuery, state }, nonce);
    assert.ok(["access_denied", "no_code"].includes(googleError(first)), googleError(first));
    const replay = await callback(A, { code: "c", state }, nonce);
    assert.equal(googleError(replay), "invalid_state");
  }
  assert.deepEqual(googleCalls(), []);
  assert.equal(await tokenRows(), 0);
});

test("T18 GET /api/settings never returns reserved keys", async () => {
  await connect(A);
  assert.equal((await pendingRows()).length, 1);
  const res = await api("/api/settings", { user: A });
  assert.equal(res.status, 200);
  assert.ok(!(PENDING_KEY in res.json), `reserved key returned: ${res.text}`);
  assert.ok(!Object.keys(res.json).some((k) => k.startsWith("_")), res.text);
});

test("T18 POST /api/settings refuses reserved keys with 400 and changes nothing", async () => {
  const { state, nonce } = await connect(A);
  const [before] = await pendingRows();
  for (const body of [{ [PENDING_KEY]: "0".repeat(64) }, { _other: "x" }, { ok_key: "1", _sneaky: "2" }]) {
    const res = await api("/api/settings", { method: "POST", user: A, body });
    assert.equal(res.status, 400, `${JSON.stringify(body)}: ${res.status} ${res.text}`);
  }
  const [afterRow] = await pendingRows();
  assert.equal(afterRow.value, before.value, "marker untouched");
  const [{ n }] = await db()`SELECT count(*)::int AS n FROM settings WHERE user_id = ${A.id} AND key IN ('ok_key', '_other', '_sneaky')`;
  assert.equal(n, 0, "nothing from a refused request is stored");
  // The flow still works after the refused writes.
  assert.equal(googleError(await callback(A, { code: "c", state }, nonce)), "token_exchange_failed");
});
