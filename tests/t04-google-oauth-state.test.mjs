// T4. Google OAuth state: the callback only accepts a state that was minted
// for the signed-in user in this browser, once, within 10 minutes.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";
import { mintState, nonceFromSetCookies, findSetCookie, NONCE_COOKIE, sign } from "./helpers/oauth.mjs";

const NETWORK_LOG = process.env.TEST_NETWORK_LOG;
const A = USERS.A;
const B = USERS.B;
const CALLBACK = "/api/calendar/google/callback";

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
async function connect(user) {
  const res = await api("/api/calendar/google?action=connect", { user });
  assert.ok([302, 303, 307, 308].includes(res.status), `connect: ${res.status} ${res.text.slice(0, 200)}`);
  const loc = new URL(res.location);
  return { res, loc, state: loc.searchParams.get("state"), nonce: nonceFromSetCookies(res.setCookies) };
}
function callback(user, query, nonce) {
  const cookies = nonce ? [`${NONCE_COOKIE}=${nonce}`] : [];
  return api(`${CALLBACK}?${new URLSearchParams(query)}`, { user, cookies });
}
function googleError(res) {
  assert.ok([302, 303, 307, 308].includes(res.status), `callback: ${res.status} ${res.text.slice(0, 200)}`);
  return new URL(res.location).searchParams.get("google_error");
}
async function assertRejected(res, label) {
  assert.equal(googleError(res), "invalid_state", label);
  assert.equal(new URL(res.location).pathname, "/settings", label);
  assert.equal(await tokenRows(), 0, `${label}: no token row`);
  assert.deepEqual(googleCalls(), [], `${label}: no call to Google`);
}

test("T4 connect redirects to Google with a state and sets the nonce cookie", async () => {
  const { loc, state, nonce, res } = await connect(A);
  assert.equal(loc.hostname, "accounts.google.com");
  assert.ok(state && state.includes("."), "state parameter present");
  assert.ok(nonce, "nonce cookie set");
  const cookie = findSetCookie(res.setCookies, NONCE_COOKIE).toLowerCase();
  assert.match(cookie, /httponly/);
  assert.match(cookie, /samesite=lax/);
  assert.match(cookie, /path=\/api\/calendar\/google\/callback/);
  assert.match(cookie, /max-age=600/);
});

test("T4 callback rejects a missing state", async () => {
  const { nonce } = await connect(A);
  await assertRejected(await callback(A, { code: "fake" }, nonce), "missing state");
});

test("T4 callback rejects a garbage state", async () => {
  const { nonce } = await connect(A);
  for (const state of ["garbage", "a.b", ".", "x".repeat(5000)]) {
    await assertRejected(await callback(A, { code: "fake", state }, nonce), `garbage ${state.slice(0, 10)}`);
  }
});

test("T4 callback rejects a valid state with no nonce cookie", async () => {
  const { state } = await connect(A);
  await assertRejected(await callback(A, { code: "fake", state }), "no cookie");
});

test("T4 callback rejects a nonce cookie from a different flow", async () => {
  const first = await connect(A);
  const second = await connect(A);
  await assertRejected(await callback(A, { code: "fake", state: first.state }, second.nonce), "other flow");
});

test("T4 callback rejects a state and cookie minted for another user", async () => {
  const b = await connect(B);
  await assertRejected(await callback(A, { code: "fake", state: b.state }, b.nonce), "B's state");
});

test("T4 callback rejects a tampered payload with the original signature", async () => {
  const { state, nonce } = await connect(A);
  const [payloadB64, sig] = state.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  payload.exp = payload.exp + 3600;
  const tampered = Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + sig;
  await assertRejected(await callback(A, { code: "fake", state: tampered }, nonce), "tampered");
});

test("T4 callback rejects an expired state", async () => {
  const minted = mintState({ userId: A.id, expSeconds: Math.floor(Date.now() / 1000) - 5 });
  await assertRejected(await callback(A, { code: "fake", state: minted.state }, minted.nonce), "expired");
});

test("T4 callback rejects a state signed with another key", async () => {
  const minted = mintState({ userId: A.id, secret: "some-other-secret-value" });
  await assertRejected(await callback(A, { code: "fake", state: minted.state }, minted.nonce), "other key");
});

test("T4 a test-minted valid state is accepted (the documented key derivation matches)", async () => {
  const minted = mintState({ userId: A.id });
  assert.equal(minted.state.split(".")[1], sign(minted.state.split(".")[0]));
  const res = await callback(A, { code: "fake", state: minted.state }, minted.nonce);
  assert.equal(googleError(res), "token_exchange_failed");
});

test("T4 valid state and cookie get past the state check, clear the cookie, and cannot be replayed", async () => {
  const { state, nonce } = await connect(A);
  const res = await callback(A, { code: "fake-code", state }, nonce);
  assert.equal(googleError(res), "token_exchange_failed");
  const calls = googleCalls();
  assert.equal(calls.length, 1, "one attempt to reach Google's token endpoint");
  assert.equal(new URL(calls[0].url).hostname, "oauth2.googleapis.com");
  const cleared = findSetCookie(res.setCookies, NONCE_COOKIE);
  assert.ok(cleared, "nonce cookie is cleared");
  assert.match(cleared.toLowerCase(), /max-age=0|expires=thu, 01 jan 1970/);
  assert.match(cleared.toLowerCase(), /path=\/api\/calendar\/google\/callback/);

  writeFileSync(NETWORK_LOG, "");
  await assertRejected(await callback(A, { code: "fake-code", state }), "replay without cookie");
});

test("T4 every rejected callback also clears the nonce cookie", async () => {
  const { nonce } = await connect(A);
  const res = await callback(A, { code: "fake", state: "garbage" }, nonce);
  assert.ok(findSetCookie(res.setCookies, NONCE_COOKIE), "cookie cleared on failure too");
});

test("T4 Google's own error is only passed on as a short safe code, after the state check", async () => {
  const { state, nonce } = await connect(A);
  const res = await callback(A, { error: "access_denied", state }, nonce);
  assert.equal(googleError(res), "access_denied");
  const again = await connect(A);
  const evil = await callback(A, { error: "<script>alert(1)</script> free text", state: again.state }, again.nonce);
  const code = googleError(evil);
  assert.match(code, /^[a-z_]+$/);
  const noState = await callback(A, { error: "access_denied" });
  assert.equal(googleError(noState), "invalid_state");
  assert.deepEqual(googleCalls(), []);
});

test("T4 signed-out callback answers 401", async () => {
  const minted = mintState({ userId: A.id });
  const res = await callback(undefined, { code: "fake", state: minted.state }, minted.nonce);
  assert.equal(res.status, 401);
  assert.deepEqual(googleCalls(), []);
});

test("T4 an admin who is impersonating cannot connect Google", async () => {
  const cookies = ["x-impersonate-user-id=" + A.id];
  const me = await api("/api/auth/me", { user: USERS.ADMIN, cookies });
  assert.equal(me.json.isImpersonating, true);
  const res = await api("/api/calendar/google?action=connect", { user: USERS.ADMIN, cookies });
  assert.equal(res.status, 403, `${res.status} ${res.text.slice(0, 200)}`);
  const minted = mintState({ userId: USERS.ADMIN.id });
  const cb = await api(`${CALLBACK}?code=fake&state=${minted.state}`, {
    user: USERS.ADMIN,
    cookies: [...cookies, `${NONCE_COOKIE}=${minted.nonce}`],
  });
  assert.equal(cb.status, 403);
  assert.equal(await tokenRows(), 0);
  assert.deepEqual(googleCalls(), []);
});
