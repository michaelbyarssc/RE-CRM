// T34. The stand-in for the sign-in service (tests/helpers/auth-stub.mjs)
// signs in only the known test users, and refuses everything else. The
// browser checks in t33 sign in through it, so it must not become an open
// door. Its answers go through the logged request helper: the leak scan
// then proves the test password (it carries the leak marker) is never
// echoed back.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { api } from "./helpers/http.mjs";
import { USERS } from "./helpers/db.mjs";
import { answer500OnError, BROWSER_PASSWORD, tokenFor } from "./helpers/auth-stub.mjs";

const base = process.env.TEST_AUTH_URL;
const stub = (path, opts = {}) => api(path, { base, ...opts });
const signIn = (body) => stub("/auth/v1/token?grant_type=password", { method: "POST", body });

test("T34 the test password carries the leak marker", () => {
  assert.ok(BROWSER_PASSWORD.includes("ZZSECRET"));
});

test("T34 password sign-in works only for a known test user with the test password", async () => {
  const ok = await signIn({ email: USERS.A.email, password: BROWSER_PASSWORD });
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
  assert.equal(ok.json.access_token, tokenFor(USERS.A));
  assert.equal(ok.json.user.id, USERS.A.id);
  assert.equal(typeof ok.json.refresh_token, "string");
  assert.ok(!ok.text.includes(BROWSER_PASSWORD), "the answer echoes the password");

  for (const body of [
    { email: USERS.A.email, password: "wrong-password" },
    { email: USERS.A.email, password: "" },
    { email: USERS.A.email },
    { email: "stranger@example.com", password: BROWSER_PASSWORD },
    { password: BROWSER_PASSWORD },
    {},
  ]) {
    const res = await signIn(body);
    assert.equal(res.status, 400, `${JSON.stringify(Object.keys(body))}: ${res.status}`);
    assert.equal(res.json?.access_token, undefined);
  }
});

test("T34 refresh works only with a refresh token the stub handed out", async () => {
  const session = (await signIn({ email: USERS.B.email, password: BROWSER_PASSWORD })).json;
  const refresh = (body) => stub("/auth/v1/token?grant_type=refresh_token", { method: "POST", body });
  const ok = await refresh({ refresh_token: session.refresh_token });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.access_token, tokenFor(USERS.B));

  const stranger = "test-refresh." + Buffer.from(JSON.stringify({ id: "x", email: "stranger@example.com" })).toString("base64url");
  for (const token of ["test-refresh-token", "made-up", "", stranger, tokenFor(USERS.B)]) {
    const res = await refresh({ refresh_token: token });
    assert.equal(res.status, 400, `${token.slice(0, 20)}: ${res.status}`);
  }
  const other = await stub("/auth/v1/token?grant_type=id_token", { method: "POST", body: {} });
  assert.equal(other.status, 400);
  const none = await stub("/auth/v1/token", { method: "POST", body: { email: USERS.A.email, password: BROWSER_PASSWORD } });
  assert.equal(none.status, 400);
});

test("T34 a body that is not a JSON object is refused, and the stub keeps answering", async () => {
  // The stub lives in the test runner's process: an error here would stop
  // the whole run. The JSON value null used to do exactly that.
  const notObjects = ["null", "[]", '["a"]', '"text"', "42", "true", "{", "not json", ""];
  for (const grant of ["password", "refresh_token"]) {
    for (const body of notObjects) {
      const res = await stub(`/auth/v1/token?grant_type=${grant}`, { method: "POST", body });
      assert.equal(res.status, 400, `${grant} with body ${JSON.stringify(body)}: ${res.status}`);
      assert.equal(res.json?.access_token, undefined);
    }
  }
  const ok = await signIn({ email: USERS.A.email, password: BROWSER_PASSWORD });
  assert.equal(ok.status, 200, "the stub stopped answering");
});

test("T34 an unexpected error in the stub's handler becomes a 500 answer", async () => {
  // A small server of its own with handlers that fail, wrapped the same way as the stub's handler.
  const failing = [
    async () => {
      throw new Error("boom");
    },
    () => {
      throw new Error("boom at once");
    },
    () => Promise.reject(new Error("boom later")),
  ];
  for (const handler of failing) {
    const server = http.createServer(answer500OnError(handler));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/anything`, { method: "POST", body: "{}" });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { code: 500, msg: "error in the test stub" });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("T34 sign-out needs a valid token", async () => {
  const ok = await stub("/auth/v1/logout?scope=global", {
    method: "POST",
    headers: { authorization: `Bearer ${tokenFor(USERS.A)}` },
  });
  assert.equal(ok.status, 204);
  assert.equal((await stub("/auth/v1/logout", { method: "POST" })).status, 401);
  const bad = await stub("/auth/v1/logout", { method: "POST", headers: { authorization: "Bearer made-up" } });
  assert.equal(bad.status, 401);
});

test("T34 a browser preflight is answered for the app's origin", async () => {
  const origin = process.env.TEST_APP_URL;
  const res = await stub("/auth/v1/token?grant_type=password", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "apikey,authorization,content-type,x-client-info",
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), origin);
  assert.match(res.headers.get("access-control-allow-methods") || "", /POST/);
  assert.match(res.headers.get("access-control-allow-headers") || "", /apikey/);
  // Answers to real calls carry the CORS header too, also when they refuse.
  const refused = await signIn({ email: USERS.A.email, password: "wrong-password" });
  assert.ok(refused.headers.get("access-control-allow-origin"));
});

test("T34 everything else is still refused", async () => {
  assert.equal((await stub("/auth/v1/user")).status, 401);
  assert.equal((await stub("/auth/v1/user", { headers: { authorization: "Bearer made-up" } })).status, 401);
  const me = await stub("/auth/v1/user", { headers: { authorization: `Bearer ${tokenFor(USERS.A)}` } });
  assert.equal(me.status, 200);
  assert.equal(me.json.id, USERS.A.id);
  for (const [method, path] of [
    ["POST", "/auth/v1/signup"],
    ["POST", "/auth/v1/recover"],
    ["POST", "/auth/v1/otp"],
    ["PUT", "/auth/v1/user"],
    ["GET", "/auth/v1/admin/users"],
    ["GET", "/auth/v1/settings"],
    ["GET", "/auth/v1/logout"],
    ["GET", "/auth/v1/token"],
    ["GET", "/rest/v1/leads"],
    ["GET", "/"],
  ]) {
    const res = await stub(path, { method, body: method === "GET" ? undefined : {} });
    assert.equal(res.status, 404, `${method} ${path}: ${res.status}`);
  }
});
