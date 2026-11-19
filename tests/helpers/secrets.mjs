// Helpers for the secret encryption tests.
//
// The runner creates a random key per run: the app servers get it as
// SETTINGS_ENCRYPTION_KEY, the tests as TEST_SETTINGS_ENCRYPTION_KEY. The
// tests use the same core as the app (lib/secrets/*.mjs), so the format and
// the context strings exist once.
//
// Every dummy secret contains the marker ZZSECRET, so leak checks can find it.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { keyRingFromEnv, encrypt, decrypt } from "../../lib/secrets/box.mjs";
import { settingContext, tokenContext } from "../../lib/secrets/policy.mjs";

export const MARKER = "ZZSECRET";

export function testKey() {
  const key = process.env.TEST_SETTINGS_ENCRYPTION_KEY;
  if (!key) throw new Error("TEST_SETTINGS_ENCRYPTION_KEY is not set: run the tests with npm test");
  return key;
}

/** The key ring the app servers use. */
export function testRing() {
  return keyRingFromEnv({ SETTINGS_ENCRYPTION_KEY: testKey() });
}

/** A fresh dummy secret with the marker, at least 12 characters. */
export function dummySecret(label = "value") {
  return `${MARKER}-${label}-${randomBytes(6).toString("hex")}`;
}

export function encryptSetting(userId, key, plaintext, ring = testRing()) {
  return encrypt(ring, plaintext, settingContext(userId, key));
}
export function decryptSetting(userId, key, stored, ring = testRing()) {
  return decrypt(ring, stored, settingContext(userId, key));
}
export function encryptTokenValue(userId, column, plaintext, ring = testRing()) {
  return encrypt(ring, plaintext, tokenContext(userId, column));
}
export function decryptTokenValue(userId, column, stored, ring = testRing()) {
  return decrypt(ring, stored, tokenContext(userId, column));
}

export const STORED_FORMAT = /^enc:v[1-9]\d*:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{22}$/;

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Every call the app tried to make to a non-local host (blocked or answered by the stand-in). */
export function outboundCalls() {
  return readFileSync(process.env.TEST_NETWORK_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
export function clearOutboundCalls() {
  writeFileSync(process.env.TEST_NETWORK_LOG, "");
}

/**
 * Switch on the local stand-in for Google's token endpoint. `answers` maps a
 * grant_type ("authorization_code", "refresh_token") to the JSON to send back.
 */
export function googleStubOn(answers) {
  writeFileSync(process.env.TEST_GOOGLE_STUB_FILE, JSON.stringify(answers));
}
export function googleStubOff() {
  const file = process.env.TEST_GOOGLE_STUB_FILE;
  if (file && existsSync(file)) rmSync(file);
}

/** Wait until a server log (app, app-nocron, app-nokey) contains `needle`. Returns the log text. */
export async function waitForServerLog(name, needle, maxMs = 5000) {
  const file = `${process.env.TEST_SERVER_LOG_DIR}/${name}.log`;
  const until = Date.now() + maxMs;
  let text = "";
  while (Date.now() < until) {
    text = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (text.includes(needle)) return text;
    await new Promise((r) => setTimeout(r, 100));
  }
  return text;
}
