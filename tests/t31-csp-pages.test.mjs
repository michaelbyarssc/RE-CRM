// T31. Every page answer carries the page security policy (CSP) with a new
// nonce, and every script tag in the page carries that nonce.
//
// The policy and the header names are written out by hand. The policy is
// enforcing: pages must not also send the report-only header.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, USERS } from "./helpers/db.mjs";

const POLICY_HEADER = "content-security-policy";
const REPORT_ONLY_HEADER = "content-security-policy-report-only";

const SUPABASE_ORIGIN = new URL(process.env.TEST_AUTH_URL).origin;

// The expected policy, with NONCE where the per-request nonce goes.
const EXPECTED = [
  ["default-src", "'self'"],
  ["script-src", "'self' 'nonce-NONCE' 'strict-dynamic'"],
  ["style-src", "'self' 'unsafe-inline'"],
  [
    "img-src",
    "'self' data: https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org",
  ],
  ["font-src", "'self' data:"],
  ["connect-src", `'self' ${SUPABASE_ORIGIN}`],
  ["frame-src", "'none'"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["frame-ancestors", "'none'"],
];

let ids;
before(async () => {
  ids = await reseed();
});
after(closeDb);

/** Read the policy of an answer. Returns { nonce, directives: [[name, sources]] }. */
function readPolicy(res, label) {
  const policy = res.headers.get(POLICY_HEADER);
  assert.ok(policy, `${label}: no ${POLICY_HEADER} header`);
  assert.equal(res.headers.get(REPORT_ONLY_HEADER), null, `${label}: also sent ${REPORT_ONLY_HEADER}`);
  const nonces = [...policy.matchAll(/'nonce-([^']*)'/g)].map((m) => m[1]);
  assert.equal(nonces.length, 1, `${label}: expected one nonce in ${policy}`);
  const nonce = nonces[0];
  const list = policy.split(";").map((part) => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources.join(" ").replace(`'nonce-${nonce}'`, "'nonce-NONCE'")];
  });
  return { nonce, directives: list, policy };
}

function assertPolicy(res, label) {
  const { nonce, directives, policy } = readPolicy(res, label);
  assert.deepEqual(directives, EXPECTED, `${label}: policy differs: ${policy}`);
  const scriptSrc = directives.find(([n]) => n === "script-src")[1].split(" ");
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "blob:", "http:", "https:"]) {
    assert.ok(!scriptSrc.includes(bad), `${label}: ${bad} in script-src`);
  }
  // Plain base64 of at least 16 bytes (128 bits); the app uses 18.
  assert.match(nonce, /^[A-Za-z0-9+/]+={0,2}$/, `${label}: nonce ${nonce}`);
  assert.ok(Buffer.from(nonce, "base64").length >= 16, `${label}: nonce too short`);
  return nonce;
}

/** Every <script> tag carries nonce="<nonce>"; there is at least one. */
function assertScriptsCarryNonce(res, nonce, label) {
  const tags = res.text.match(/<script\b[^>]*>/gi) || [];
  assert.ok(tags.length > 0, `${label}: no script tag in the page`);
  for (const tag of tags) {
    const m = tag.match(/\snonce="([^"]*)"/);
    assert.ok(m, `${label}: script tag without a nonce: ${tag.slice(0, 120)}`);
    assert.equal(m[1], nonce, `${label}: script tag with another nonce: ${tag.slice(0, 120)}`);
  }
  return tags.length;
}

function assertNotSharedCacheable(res, label) {
  const cc = (res.headers.get("cache-control") || "").toLowerCase();
  assert.ok(!/s-maxage/.test(cc), `${label}: cache-control ${cc}`);
  assert.ok(!/\bpublic\b/.test(cc), `${label}: cache-control ${cc}`);
}

function pagePaths() {
  return [
    "/",
    "/leads",
    `/leads/${ids.aLead}`,
    "/leads/import",
    "/pipeline",
    "/map",
    "/skip-trace",
    "/dialer",
    "/buyers",
    "/calendar",
    "/sequences",
    `/sequences/${ids.aSeq}`,
    "/settings",
    "/knowledge-base",
    "/welcome",
    "/privacy",
    "/terms",
  ];
}

test("T31 signed-out pages carry the policy, and every script tag its nonce", async () => {
  for (const path of ["/login", "/privacy", "/terms"]) {
    const res = await api(path);
    assert.equal(res.status, 200, `${path}: ${res.status}`);
    const nonce = assertPolicy(res, path);
    assertScriptsCarryNonce(res, nonce, path);
    assertNotSharedCacheable(res, path);
  }
});

test("T31 every signed-in page carries the policy, and every script tag its nonce", async () => {
  const paths = pagePaths();
  assert.equal(paths.length + 1, 18, "17 pages here plus /login: the 18 page routes");
  for (const path of paths) {
    const res = await api(path, { user: USERS.A });
    assert.equal(res.status, 200, `${path}: ${res.status} ${res.location ?? ""}`);
    const nonce = assertPolicy(res, path);
    assertScriptsCarryNonce(res, nonce, path);
    assertNotSharedCacheable(res, path);
  }
});

test("T31 /login signed in (a redirect to the dashboard) carries the policy", async () => {
  const res = await api("/login", { user: USERS.A });
  assert.ok(res.status >= 300 && res.status < 400, `${res.status}`);
  assertPolicy(res, "/login signed in");
});

test("T31 an unknown page (404) carries the policy, and its scripts the nonce", async () => {
  const res = await api("/no-such-page-t31", { user: USERS.A });
  assert.equal(res.status, 404);
  const nonce = assertPolicy(res, "404");
  assertScriptsCarryNonce(res, nonce, "404");
  assertNotSharedCacheable(res, "404");
});

test("T31 the signed-out redirect to /login carries the policy", async () => {
  for (const path of ["/", "/map", "/no-such-page-t31"]) {
    const res = await api(path);
    assert.ok(res.status >= 300 && res.status < 400, `${path}: ${res.status}`);
    assert.equal(new URL(res.location, "http://x").pathname, "/login");
    assertPolicy(res, `${path} signed out`);
  }
});

test("T31 the nonce is new on every request for the same page", async () => {
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const res = await api("/login");
    seen.add(readPolicy(res, "/login").nonce);
  }
  assert.equal(seen.size, 3, "three requests gave a repeated nonce");
  const a = readPolicy(await api("/", { user: USERS.A }), "/").nonce;
  const b = readPolicy(await api("/", { user: USERS.A }), "/").nonce;
  assert.notEqual(a, b);
});

test("T31 a policy header or x-nonce sent by the visitor is never the one the page uses", async () => {
  const fake = "RkFLRUZBS0VGQUtFRkFLRQ==";
  const res = await api("/login", {
    headers: {
      "content-security-policy": `script-src 'nonce-${fake}'`,
      "content-security-policy-report-only": `script-src 'nonce-${fake}'`,
      "x-nonce": fake,
    },
  });
  assert.equal(res.status, 200);
  const nonce = assertPolicy(res, "/login with visitor headers");
  assert.notEqual(nonce, fake);
  assert.ok(!res.text.includes(fake), "the visitor's nonce appears in the page");
  assertScriptsCarryNonce(res, nonce, "/login with visitor headers");
});
