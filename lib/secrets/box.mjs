// Encryption core for saved secrets (settings keys and Google tokens).
//
// Plain Node ESM with JSDoc types, so the app (TypeScript), the one-off
// script (scripts/encrypt-existing-secrets.mjs) and the tests all use this
// one copy. It never reads the environment on import: callers pass it in.
//
// Stored text: enc:v<N>:<iv>:<ciphertext>:<tag>
//   N           key version (1 = SETTINGS_ENCRYPTION_KEY, 2 = SETTINGS_ENCRYPTION_KEY_V2, ...)
//   iv          12 random bytes, new for every encryption
//   ciphertext  AES-256-GCM output
//   tag         16 byte GCM tag
// Each part is base64url without padding. The context string (see
// policy.mjs) is the additional authenticated data, so a value copied to
// another user or column does not decrypt.
//
// Errors never contain the plain text, the stored text or key material.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export const KEY_VARIABLE = "SETTINGS_ENCRYPTION_KEY";
export const ENCRYPTED_PREFIX = "enc:";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FINGERPRINT_LABEL = "re-crm/settings-key-fingerprint/v1";
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const VERSIONED_NAME = /^SETTINGS_ENCRYPTION_KEY_V([1-9]\d{0,5})$/;

/** The key is missing or malformed. The message names the variable, never its value. */
export class SecretsConfigError extends Error {
  /**
   * @param {"missing" | "malformed" | "bad_name"} reason
   * @param {string} variable
   * @param {string} message
   */
  constructor(reason, variable, message) {
    super(message);
    this.name = "SecretsConfigError";
    this.reason = reason;
    this.variable = variable;
  }
}

/** A stored value could not be decrypted (tampered, wrong key, wrong context, unknown version). */
export class SecretDecryptError extends Error {
  constructor() {
    super("The saved value could not be decrypted");
    this.name = "SecretDecryptError";
  }
}

/**
 * @typedef {{ current: number, keys: Map<number, Buffer> }} KeyRing
 * `current` is the highest version present: it encrypts. Every version present can decrypt.
 */

/**
 * Decode one key variable. 32 bytes in standard or URL-safe base64.
 * @param {string} variable
 * @param {string} value
 * @returns {Buffer}
 */
function decodeKey(variable, value) {
  const text = value.trim();
  const bad = () =>
    new SecretsConfigError(
      "malformed",
      variable,
      `${variable} must be 32 random bytes in base64 (create one with: openssl rand -base64 32).`
    );
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) throw bad();
  const key = Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (key.length !== KEY_BYTES) throw bad();
  return key;
}

/**
 * Build the key ring from an environment object. Reads SETTINGS_ENCRYPTION_KEY
 * (version 1) and SETTINGS_ENCRYPTION_KEY_V2, _V3, ... An empty variable counts
 * as missing. Throws SecretsConfigError when no key is present, any present
 * key is malformed, or a non-empty variable starts with SETTINGS_ENCRYPTION_KEY
 * but is not one of those names (for example _v2 or _OLD): a typo during a
 * rotation must not be silently ignored.
 * @param {Record<string, string | undefined>} env
 * @returns {KeyRing}
 */
export function keyRingFromEnv(env) {
  /** @type {Map<number, Buffer>} */
  const keys = new Map();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(KEY_VARIABLE)) continue;
    if (typeof value !== "string" || value.trim() === "") continue;
    let version;
    if (name === KEY_VARIABLE) {
      version = 1;
    } else {
      const m = VERSIONED_NAME.exec(name);
      version = m ? Number(m[1]) : 0;
      if (version < 2) {
        throw new SecretsConfigError(
          "bad_name",
          name,
          `${name} is not a valid key name: use ${KEY_VARIABLE} for version 1 and ${KEY_VARIABLE}_V2, _V3 and so on after that.`
        );
      }
    }
    keys.set(version, decodeKey(name, value));
  }
  if (keys.size === 0) {
    throw new SecretsConfigError(
      "missing",
      KEY_VARIABLE,
      `${KEY_VARIABLE} is not set (create one with: openssl rand -base64 32).`
    );
  }
  return { current: Math.max(...keys.keys()), keys };
}

/**
 * True if the stored text is in the encrypted format (or claims to be).
 * Anything else is a legacy plain-text value.
 * @param {unknown} stored
 * @returns {boolean}
 */
export function isEncrypted(stored) {
  return typeof stored === "string" && stored.startsWith(ENCRYPTED_PREFIX);
}

/**
 * The key version of an encrypted value, or null if it is not in the format.
 * @param {string} stored
 * @returns {number | null}
 */
export function versionOf(stored) {
  if (!isEncrypted(stored)) return null;
  const m = /^enc:v([1-9]\d{0,5}):/.exec(stored);
  return m ? Number(m[1]) : null;
}

/**
 * Encrypt with the current key, bound to `context`.
 * @param {KeyRing} ring
 * @param {string} plaintext must be a non-empty string
 * @param {string} context from policy.mjs
 * @returns {string}
 */
export function encrypt(ring, plaintext, context) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TypeError("encrypt needs a non-empty string");
  }
  if (typeof context !== "string" || context.length === 0) {
    throw new TypeError("encrypt needs a context");
  }
  const key = ring.keys.get(ring.current);
  if (!key) throw new TypeError("The key ring has no current key");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "enc",
    `v${ring.current}`,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a stored value bound to `context`. Throws SecretDecryptError on any problem.
 * @param {KeyRing} ring
 * @param {string} stored
 * @param {string} context
 * @returns {string}
 */
export function decrypt(ring, stored, context) {
  if (typeof stored !== "string" || typeof context !== "string") throw new SecretDecryptError();
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "enc") throw new SecretDecryptError();
  const [, versionPart, ivPart, dataPart, tagPart] = parts;
  if (!/^v[1-9]\d{0,5}$/.test(versionPart)) throw new SecretDecryptError();
  if (![ivPart, dataPart, tagPart].every((p) => BASE64URL.test(p))) throw new SecretDecryptError();
  const key = ring.keys.get(Number(versionPart.slice(1)));
  if (!key) throw new SecretDecryptError();
  const iv = Buffer.from(ivPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || data.length === 0) throw new SecretDecryptError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptError();
  }
}

/**
 * A short, safe-to-show fingerprint of a key: the first 8 hex characters of
 * HMAC-SHA256(key, "re-crm/settings-key-fingerprint/v1").
 * @param {Buffer} key
 * @returns {string}
 */
export function keyFingerprint(key) {
  return createHmac("sha256", key).update(FINGERPRINT_LABEL).digest("hex").slice(0, 8);
}

/**
 * The fingerprint of the current (encrypting) key of a ring.
 * @param {KeyRing} ring
 * @returns {string}
 */
export function currentFingerprint(ring) {
  const key = ring.keys.get(ring.current);
  if (!key) throw new TypeError("The key ring has no current key");
  return keyFingerprint(key);
}
