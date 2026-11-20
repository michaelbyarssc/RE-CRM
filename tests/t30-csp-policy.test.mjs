// T30. The page security policy (CSP) builder in lib/security/csp.mjs,
// tested directly. No app server is needed.
//
// The expected policy is written out by hand here on purpose. When the
// policy changes (for example a new outside service), update this list.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPagePolicy,
  makeNonce,
  supabaseOrigin,
  ENFORCE,
  POLICY_HEADER,
  OTHER_POLICY_HEADER,
} from "../lib/security/csp.mjs";

const NONCE = "MTIzNDU2NzgtYWJjZC00ZWYwLTlhYmMtZGVmMDEyMzQ1Njc4";
const SUPABASE = "https://abcdefgh.supabase.co";

const EXPECTED_PRODUCTION = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** "a b c; d e" -> Map { a => [b, c], d => [e] } */
function directives(policy) {
  const map = new Map();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    assert.ok(!map.has(name), `directive ${name} appears twice in ${policy}`);
    map.set(name, sources);
  }
  return map;
}

// The policy is enforcing. Going back to report-only must be a deliberate
// change, and this test is meant to fail when someone makes it.
test("T30 the policy is enforcing: the header is Content-Security-Policy", () => {
  assert.equal(ENFORCE, true);
  assert.equal(POLICY_HEADER, "Content-Security-Policy");
  assert.equal(OTHER_POLICY_HEADER, "Content-Security-Policy-Report-Only");
});

test("T30 the production policy is exactly the expected list", () => {
  const policy = buildPagePolicy({ nonce: NONCE, isDev: false, supabaseUrl: SUPABASE });
  assert.equal(policy, EXPECTED_PRODUCTION);
  // isDev left out means production.
  assert.equal(buildPagePolicy({ nonce: NONCE, supabaseUrl: SUPABASE }), EXPECTED_PRODUCTION);
});

test("T30 development adds 'unsafe-eval' to script-src and changes nothing else", () => {
  const prod = directives(buildPagePolicy({ nonce: NONCE, isDev: false, supabaseUrl: SUPABASE }));
  const dev = directives(buildPagePolicy({ nonce: NONCE, isDev: true, supabaseUrl: SUPABASE }));
  assert.deepEqual([...dev.keys()], [...prod.keys()]);
  for (const [name, sources] of prod) {
    if (name === "script-src") {
      assert.deepEqual(dev.get(name), [...sources, "'unsafe-eval'"]);
    } else {
      assert.deepEqual(dev.get(name), sources, name);
    }
  }
});

test("T30 script-src never allows inline scripts, eval in production, wildcards or bare schemes", () => {
  for (const isDev of [false, true]) {
    const scriptSrc = directives(buildPagePolicy({ nonce: NONCE, isDev, supabaseUrl: SUPABASE })).get("script-src");
    assert.ok(!scriptSrc.includes("'unsafe-inline'"), `isDev=${isDev}: ${scriptSrc}`);
    for (const bad of ["*", "data:", "blob:", "http:", "https:", "'unsafe-hashes'"]) {
      assert.ok(!scriptSrc.includes(bad), `isDev=${isDev}: ${bad} in ${scriptSrc}`);
    }
    if (!isDev) assert.ok(!scriptSrc.includes("'unsafe-eval'"), `${scriptSrc}`);
  }
});

test("T30 style-src has no nonce (a nonce would switch off 'unsafe-inline' for Leaflet and FullCalendar)", () => {
  const styleSrc = directives(buildPagePolicy({ nonce: NONCE, supabaseUrl: SUPABASE })).get("style-src");
  assert.deepEqual(styleSrc, ["'self'", "'unsafe-inline'"]);
});

test("T30 no upgrade-insecure-requests", () => {
  assert.ok(!buildPagePolicy({ nonce: NONCE, supabaseUrl: SUPABASE }).includes("upgrade-insecure-requests"));
});

test("T30 the Supabase source is the origin of the address only", () => {
  const cases = [
    ["https://abcdefgh.supabase.co", "https://abcdefgh.supabase.co"],
    ["https://abcdefgh.supabase.co/", "https://abcdefgh.supabase.co"],
    ["https://abcdefgh.supabase.co/rest/v1?x=1#y", "https://abcdefgh.supabase.co"],
    ["http://127.0.0.1:54329", "http://127.0.0.1:54329"],
    ["https://abcdefgh.supabase.co:8443/auth", "https://abcdefgh.supabase.co:8443"],
    ["HTTPS://ABCDEFGH.Supabase.CO:443", "https://abcdefgh.supabase.co"],
    ["  https://abcdefgh.supabase.co  ", "https://abcdefgh.supabase.co"],
    ["https://user:pass@abcdefgh.supabase.co", "https://abcdefgh.supabase.co"],
  ];
  for (const [value, origin] of cases) {
    assert.equal(supabaseOrigin(value), origin, JSON.stringify(value));
    const connect = directives(buildPagePolicy({ nonce: NONCE, supabaseUrl: value })).get("connect-src");
    assert.deepEqual(connect, ["'self'", origin], JSON.stringify(value));
  }
});

test("T30 a missing, empty, invalid or strange Supabase address adds no source and no directive", () => {
  const bad = [
    undefined,
    null,
    "",
    "   ",
    "not a url",
    "abcdefgh.supabase.co",
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://abcdefgh.supabase.co",
    "file:///etc/passwd",
    "https://abcdefgh.supabase.co;script-src *",
    "https://abcdefgh.supabase.co; script-src 'unsafe-inline'",
    "https://abcdefgh.supabase.co https://evil.example",
    "https://abcdefgh.supabase.co,https://evil.example",
    "https://abc'def.supabase.co",
    'https://abc"def.supabase.co',
    "https://abcdefgh.supabase.co%3Bscript-src",
    "https://abcdefgh.supabase.co\nscript-src *",
    "https://abcdefgh.supabase.co\r\nX-Evil: 1",
    12345,
  ];
  const clean = buildPagePolicy({ nonce: NONCE });
  assert.equal(directives(clean).get("connect-src").join(" "), "'self'");
  for (const value of bad) {
    assert.equal(supabaseOrigin(value), null, JSON.stringify(value));
    assert.equal(buildPagePolicy({ nonce: NONCE, supabaseUrl: value }), clean, JSON.stringify(value));
  }
});

test("T30 whatever the Supabase address, the policy keeps 11 directives and connect-src at most 2 sources", () => {
  // Newlines and tabs are dropped by the URL parser, so this one is a clean origin.
  const values = ["https://abc\ndefgh.supabase.co", "https://abc\tdefgh.supabase.co", "https://[::1]:8080"];
  for (const value of values) {
    const policy = buildPagePolicy({ nonce: NONCE, supabaseUrl: value });
    assert.doesNotMatch(policy, /[\r\n\t,]/, JSON.stringify(value));
    const map = directives(policy);
    assert.equal(map.size, 11, JSON.stringify(value));
    assert.ok(map.get("connect-src").length <= 2, JSON.stringify(value));
  }
});

test("T30 a nonce that is not plain base64 is refused", () => {
  const bad = [
    undefined,
    "",
    "abc",
    "abc;def=",
    "AAAA BBBB",
    "AAAA'",
    "AAAA\n",
    "AAAA; script-src *",
    "AA-_AAAA",
    "AAAA=AAA",
    "AAA",
    123,
  ];
  for (const nonce of bad) {
    assert.throws(() => buildPagePolicy({ nonce, supabaseUrl: SUPABASE }), TypeError, JSON.stringify(nonce));
  }
  assert.throws(() => buildPagePolicy(), TypeError);
});

test("T30 makeNonce gives plain base64 of 18 random bytes, new every time", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const nonce = makeNonce();
    assert.match(nonce, /^[A-Za-z0-9+/]+={0,2}$/);
    // 18 bytes is 144 random bits (the CSP standard asks for at least 128).
    assert.equal(Buffer.from(nonce, "base64").length, 18);
    seen.add(nonce);
    // Every nonce it makes is accepted by the builder.
    buildPagePolicy({ nonce });
  }
  assert.equal(seen.size, 1000);
});
