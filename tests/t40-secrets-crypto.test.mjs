// T40. The encryption core (lib/secrets/box.mjs) and the secret rules
// (lib/secrets/policy.mjs), tested directly. No app server is needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  keyRingFromEnv,
  encrypt,
  decrypt,
  isEncrypted,
  versionOf,
  keyFingerprint,
  currentFingerprint,
  SecretsConfigError,
  SecretDecryptError,
} from "../lib/secrets/box.mjs";
import {
  PUBLIC_SETTING_KEYS,
  isSecretSetting,
  settingContext,
  tokenContext,
  lastFour,
  isBlank,
} from "../lib/secrets/policy.mjs";
import { STORED_FORMAT, MARKER } from "./helpers/secrets.mjs";

const key1 = randomBytes(32).toString("base64");
const key2 = randomBytes(32).toString("base64");
const ring1 = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: key1 });
const ctx = settingContext("user-1", "twilio_auth_token");
const plain = `${MARKER}-unit-test-value-0001`;

function parts(stored) {
  return stored.split(":");
}
function b64(buf) {
  return Buffer.from(buf).toString("base64url");
}
function flipFirstByte(part) {
  const buf = Buffer.from(part, "base64url");
  buf[0] ^= 0x01;
  return b64(buf);
}
function assertNoLeak(err, ...values) {
  const text = `${err.message} ${err.stack || ""}`;
  for (const v of values) assert.ok(!text.includes(v), "error text must not contain a secret, stored text or key");
}

test("T40 round trip, and the stored text matches the format", () => {
  const stored = encrypt(ring1, plain, ctx);
  assert.match(stored, STORED_FORMAT);
  assert.ok(stored.startsWith("enc:v1:"));
  assert.ok(!stored.includes(plain));
  assert.equal(isEncrypted(stored), true);
  assert.equal(versionOf(stored), 1);
  assert.equal(decrypt(ring1, stored, ctx), plain);
  const unicode = "ZZSECRET-ünïcödé-🔑-value";
  assert.equal(decrypt(ring1, encrypt(ring1, unicode, ctx), ctx), unicode);
});

test("T40 two encryptions of the same text differ (fresh IV)", () => {
  const a = encrypt(ring1, plain, ctx);
  const b = encrypt(ring1, plain, ctx);
  assert.notEqual(a, b);
  assert.notEqual(parts(a)[2], parts(b)[2]);
});

test("T40 a changed IV, ciphertext, tag or version fails", () => {
  const stored = encrypt(ring1, plain, ctx);
  const p = parts(stored);
  const variants = {
    iv: [p[0], p[1], flipFirstByte(p[2]), p[3], p[4]],
    ciphertext: [p[0], p[1], p[2], flipFirstByte(p[3]), p[4]],
    tag: [p[0], p[1], p[2], p[3], flipFirstByte(p[4])],
    version: [p[0], "v2", p[2], p[3], p[4]],
    prefix: ["xnc", p[1], p[2], p[3], p[4]],
  };
  for (const [name, v] of Object.entries(variants)) {
    assert.throws(() => decrypt(ring1, v.join(":"), ctx), SecretDecryptError, name);
  }
  const ring12 = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: key1, SETTINGS_ENCRYPTION_KEY_V2: key2 });
  assert.throws(() => decrypt(ring12, variants.version.join(":"), ctx), SecretDecryptError, "version 2 key");
});

test("T40 a different context (user, key or column) fails", () => {
  const stored = encrypt(ring1, plain, ctx);
  for (const other of [
    settingContext("user-2", "twilio_auth_token"),
    settingContext("user-1", "reiskip_api_key"),
    tokenContext("user-1", "access_token"),
  ]) {
    assert.throws(() => decrypt(ring1, stored, other), SecretDecryptError);
  }
  const tok = encrypt(ring1, plain, tokenContext("user-1", "access_token"));
  assert.throws(() => decrypt(ring1, tok, tokenContext("user-1", "refresh_token")), SecretDecryptError);
});

test("T40 a wrong key fails, without leaking anything in the error", () => {
  const stored = encrypt(ring1, plain, ctx);
  const other = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: key2 });
  try {
    decrypt(other, stored, ctx);
    assert.fail("decrypt with the wrong key must throw");
  } catch (err) {
    assert.ok(err instanceof SecretDecryptError);
    assertNoLeak(err, plain, stored, key1, key2);
  }
});

test("T40 a short tag, a short IV, an empty ciphertext or a malformed value is refused", () => {
  const stored = encrypt(ring1, plain, ctx);
  const p = parts(stored);
  const tag = Buffer.from(p[4], "base64url");
  const iv = Buffer.from(p[2], "base64url");
  const bad = [
    [p[0], p[1], p[2], p[3], b64(tag.subarray(0, 12))].join(":"),
    [p[0], p[1], p[2], p[3], b64(tag.subarray(0, 4))].join(":"),
    [p[0], p[1], b64(iv.subarray(0, 8)), p[3], p[4]].join(":"),
    [p[0], p[1], b64(Buffer.concat([iv, Buffer.alloc(4)])), p[3], p[4]].join(":"),
    [p[0], p[1], p[2], "", p[4]].join(":"),
    [p[0], p[1], p[2], p[3] + "=", p[4]].join(":"),
    `${stored}:extra`,
    "enc:v1:abc",
    "enc:",
    "",
  ];
  for (const v of bad) assert.throws(() => decrypt(ring1, v, ctx), SecretDecryptError, v.slice(0, 40));
});

test("T40 encrypting an empty or non-string value is an error", () => {
  for (const v of ["", undefined, null, 5, {}]) {
    assert.throws(() => encrypt(ring1, v, ctx), TypeError);
  }
  assert.throws(() => encrypt(ring1, plain, ""), TypeError);
});

test("T40 missing, short and malformed keys fail closed with a message that names the variable, not the value", () => {
  for (const env of [{}, { SETTINGS_ENCRYPTION_KEY: "" }, { SETTINGS_ENCRYPTION_KEY: "   " }, { OTHER: key1 }]) {
    try {
      keyRingFromEnv(env);
      assert.fail("a missing key must throw");
    } catch (err) {
      assert.ok(err instanceof SecretsConfigError);
      assert.equal(err.reason, "missing");
      assert.match(err.message, /SETTINGS_ENCRYPTION_KEY/);
    }
  }
  const short = randomBytes(16).toString("base64");
  const long = randomBytes(48).toString("base64");
  const notBase64 = "ZZSECRET not base64 at all !!";
  const cases = [
    ["SETTINGS_ENCRYPTION_KEY", short],
    ["SETTINGS_ENCRYPTION_KEY", long],
    ["SETTINGS_ENCRYPTION_KEY", notBase64],
    ["SETTINGS_ENCRYPTION_KEY_V2", short],
  ];
  for (const [name, value] of cases) {
    const env = { SETTINGS_ENCRYPTION_KEY: key1, [name]: value };
    try {
      keyRingFromEnv(env);
      assert.fail(`${name} malformed must throw`);
    } catch (err) {
      assert.ok(err instanceof SecretsConfigError);
      assert.equal(err.reason, "malformed");
      assert.equal(err.variable, name);
      assert.ok(err.message.includes(name));
      assertNoLeak(err, value, key1);
    }
  }
  for (const name of ["SETTINGS_ENCRYPTION_KEY_V1", "SETTINGS_ENCRYPTION_KEY_V0", "SETTINGS_ENCRYPTION_KEY_V02"]) {
    assert.throws(() => keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: key1, [name]: key2 }), SecretsConfigError, name);
  }
});

test("T40 a near-miss key variable name fails closed and names the variable, not the value", () => {
  const names = [
    "SETTINGS_ENCRYPTION_KEY_v2",
    "SETTINGS_ENCRYPTION_KEY_OLD",
    "SETTINGS_ENCRYPTION_KEY2",
    "SETTINGS_ENCRYPTION_KEY_V",
    "SETTINGS_ENCRYPTION_KEY_V2_NEW",
    "SETTINGS_ENCRYPTION_KEYS",
  ];
  for (const name of names) {
    for (const env of [{ SETTINGS_ENCRYPTION_KEY: key1, [name]: key2 }, { [name]: key2 }]) {
      try {
        keyRingFromEnv(env);
        assert.fail(`${name} must be refused`);
      } catch (err) {
        assert.ok(err instanceof SecretsConfigError, name);
        assert.equal(err.reason, "bad_name", name);
        assert.equal(err.variable, name);
        assert.ok(err.message.includes(name));
        assertNoLeak(err, key1, key2);
      }
    }
  }
  // Empty near-miss variables are ignored, and other names are never looked at.
  assert.equal(keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: key1, SETTINGS_ENCRYPTION_KEY_OLD: "" }).current, 1);
  assert.equal(keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: key1, MY_SETTINGS_ENCRYPTION_KEY_X: key2 }).current, 1);
  assert.equal(keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: key1, SETTINGS_ENCRYPTION_KEY_V12: key2 }).current, 12);
});

test("T40 a key in URL-safe base64, or with a trailing newline, is accepted", () => {
  const raw = randomBytes(32);
  const a = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: raw.toString("base64url") });
  const b = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: raw.toString("base64") + "\n" });
  assert.deepEqual(a.keys.get(1), raw);
  assert.deepEqual(b.keys.get(1), raw);
});

test("T40 with _V2 present, new values use v2 and old v1 values still decrypt", () => {
  const oldValue = encrypt(ring1, plain, ctx);
  const ring12 = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: key1, SETTINGS_ENCRYPTION_KEY_V2: key2 });
  assert.equal(ring12.current, 2);
  const newValue = encrypt(ring12, plain, ctx);
  assert.equal(versionOf(newValue), 2);
  assert.equal(decrypt(ring12, oldValue, ctx), plain);
  assert.equal(decrypt(ring12, newValue, ctx), plain);
  assert.throws(() => decrypt(ring1, newValue, ctx), SecretDecryptError, "v1-only ring cannot read v2");
  const ring2only = keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY_V2: key2 });
  assert.equal(ring2only.current, 2);
  assert.equal(decrypt(ring2only, newValue, ctx), plain);
  assert.throws(() => decrypt(ring2only, oldValue, ctx), SecretDecryptError, "removed v1 key");
});

test("T40 the fingerprint is stable and 8 hex characters", () => {
  const raw = Buffer.from(key1, "base64");
  const fp = keyFingerprint(raw);
  assert.match(fp, /^[0-9a-f]{8}$/);
  assert.equal(keyFingerprint(Buffer.from(raw)), fp);
  assert.equal(currentFingerprint(ring1), fp);
  assert.notEqual(keyFingerprint(Buffer.from(key2, "base64")), fp);
  // Fixed vector: HMAC-SHA256(32 zero bytes, "re-crm/settings-key-fingerprint/v1").
  assert.equal(keyFingerprint(Buffer.alloc(32)), "36485f4d");
});

test("T40 secret by default: only twilio_phone_number is public", () => {
  assert.deepEqual([...PUBLIC_SETTING_KEYS], ["twilio_phone_number"]);
  for (const k of ["twilio_account_sid", "twilio_auth_token", "reiskip_api_key", "batchskiptracing_api_key", "skipengine_api_key", "made_up_future_key"]) {
    assert.equal(isSecretSetting(k), true, k);
  }
  assert.equal(isSecretSetting("twilio_phone_number"), false);
});

test("T40 contexts, last 4 and blank rules", () => {
  assert.equal(settingContext("u", "k"), JSON.stringify(["settings", "u", "k"]));
  assert.equal(tokenContext("u", "access_token"), JSON.stringify(["google_calendar_tokens", "u", "access_token"]));
  assert.throws(() => tokenContext("u", "expires_at"), TypeError);
  assert.throws(() => settingContext("", "k"), TypeError);
  assert.equal(lastFour("ZZSECRET-ab"), null, "11 characters is too short");
  assert.equal(lastFour("ZZSECRET-abc"), "-abc", "12 characters shows the last 4");
  assert.equal(lastFour("  ZZSECRET-abcd  "), "abcd");
  assert.equal(lastFour("short"), null);
  for (const v of ["", "   ", "\n\t", null, undefined]) assert.equal(isBlank(v), true);
  assert.equal(isBlank(" x "), false);
});
