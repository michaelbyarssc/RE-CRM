// T32. The fixed security headers from next.config.ts arrive on every kind
// of answer: pages, redirects, API answers, static files and the 404 page.
// API answers carry their own strict policy and no nonce. No answer says
// which server software it runs (X-Powered-By).
//
// The harness runs a production build, so HSTS must be present.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, USERS } from "./helpers/db.mjs";

const FIXED = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy":
    "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()",
  "strict-transport-security": "max-age=63072000",
};
const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

before(reseed);
after(closeDb);

function assertFixed(res, label) {
  for (const [name, value] of Object.entries(FIXED)) {
    assert.equal(res.headers.get(name), value, `${label}: ${name}`);
  }
  assert.equal(res.headers.get("x-powered-by"), null, `${label}: X-Powered-By is sent`);
}

function assertApiPolicy(res, label) {
  assert.equal(res.headers.get("content-security-policy"), API_POLICY, `${label}: API policy`);
  assert.equal(res.headers.get("content-security-policy-report-only"), null, `${label}: report-only policy on API`);
  assert.ok(!API_POLICY.includes("nonce-"));
  assert.equal(res.headers.get("x-nonce"), null, `${label}: x-nonce leaked`);
}

/** A real /_next/static file named in the login page. */
async function staticFileUrl() {
  const page = await api("/login");
  const m = page.text.match(/\/_next\/static\/[^"'\s>]+\.(?:js|css)/);
  assert.ok(m, "no /_next/static file named in /login");
  return m[0];
}

test("T32 a page (signed out and signed in) carries the fixed headers", async () => {
  assertFixed(await api("/login"), "/login");
  assertFixed(await api("/", { user: USERS.A }), "/ signed in");
  assertFixed(await api("/map", { user: USERS.A }), "/map signed in");
});

test("T32 the signed-out redirect to /login carries the fixed headers", async () => {
  const res = await api("/");
  assert.ok(res.status >= 300 && res.status < 400, `${res.status}`);
  assertFixed(res, "signed-out redirect");
});

test("T32 an API JSON answer (signed in) carries the fixed headers and the API policy", async () => {
  const res = await api("/api/auth/me", { user: USERS.A });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /application\/json/);
  assertFixed(res, "/api/auth/me");
  assertApiPolicy(res, "/api/auth/me");
});

test("T32 a 401 API answer carries the fixed headers and the API policy", async () => {
  for (const [method, path] of [
    ["GET", "/api/leads"],
    ["POST", "/api/settings"],
  ]) {
    const res = await api(path, { method, body: method === "GET" ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${path}`);
    assertFixed(res, `401 ${method} ${path}`);
    assertApiPolicy(res, `401 ${method} ${path}`);
  }
});

test("T32 an API redirect (Google connect) carries the fixed headers and the API policy", async () => {
  const res = await api("/api/calendar/google?action=connect", { user: USERS.A });
  assert.ok(res.status >= 300 && res.status < 400, `${res.status} ${res.text.slice(0, 200)}`);
  assertFixed(res, "Google connect redirect");
  assertApiPolicy(res, "Google connect redirect");
});

test("T32 a static file under /_next/static and /favicon.ico carry the fixed headers", async () => {
  const file = await staticFileUrl();
  const res = await api(file);
  assert.equal(res.status, 200, file);
  assertFixed(res, file);
  const icon = await api("/favicon.ico");
  assert.equal(icon.status, 200);
  assertFixed(icon, "/favicon.ico");
});

test("T32 the 404 page carries the fixed headers", async () => {
  const res = await api("/no-such-page-t32", { user: USERS.A });
  assert.equal(res.status, 404);
  assertFixed(res, "404");
});
