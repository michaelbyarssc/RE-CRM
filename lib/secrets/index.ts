import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { HttpError } from "@/lib/errors";
import {
  SecretsConfigError,
  currentFingerprint,
  decrypt,
  encrypt,
  isEncrypted,
  keyRingFromEnv,
  versionOf,
  type KeyRing,
} from "./box.mjs";
import { isBlank, isSecretSetting, settingContext, tokenContext } from "./policy.mjs";

export {
  PUBLIC_SETTING_KEYS,
  RESERVED_SETTING_PREFIX,
  isReservedSetting,
  isSecretSetting,
  isBlank,
  lastFour,
} from "./policy.mjs";

// Server-side wrapper around the shared core in box.mjs and policy.mjs.
// The key is read at first use, never when this module loads, so the app
// builds with no environment variables.

export const ENCRYPTION_NOT_CONFIGURED_MESSAGE =
  "This server is missing its SETTINGS_ENCRYPTION_KEY setting, so keys cannot be saved. Ask the site owner to add it.";
export const GOOGLE_ENCRYPTION_NOT_CONFIGURED_MESSAGE =
  "This server is missing its SETTINGS_ENCRYPTION_KEY setting, so Google Calendar cannot be connected or used. Ask the site owner to add it.";

/** 503: the encryption key is missing or malformed. Nothing is stored in plain text instead. */
export class EncryptionNotConfiguredError extends HttpError {
  constructor(message = ENCRYPTION_NOT_CONFIGURED_MESSAGE) {
    super(503, message);
    this.name = "EncryptionNotConfiguredError";
  }
}

// The environment does not change while a server runs, so the result (the
// ring, or the reason there is none) is worked out once per process.
let cached: { ring: KeyRing | null; problem: string | null } | null = null;

function problemText(err: SecretsConfigError): string {
  // Fixed text from the variable NAME and the reason only, never the value.
  if (err.reason === "missing") return `${err.variable} is missing`;
  if (err.reason === "bad_name") return `${err.variable} is not a valid key variable name`;
  return `${err.variable} is not 32 bytes of base64`;
}

function loadKeyRing(): { ring: KeyRing | null; problem: string | null } {
  if (cached) return cached;
  try {
    cached = { ring: keyRingFromEnv(process.env), problem: null };
  } catch (err) {
    if (!(err instanceof SecretsConfigError)) throw err;
    cached = { ring: null, problem: problemText(err) };
    // Logged once per process.
    console.error(`Secret encryption is off: ${cached.problem}.`);
  }
  return cached;
}

// Key versions that saved values asked for and this server does not have
// (for example after SETTINGS_ENCRYPTION_KEY_V2 was renamed), as seen since
// this process started. Each one is logged once.
const missingVersions = new Set<number>();

/** The environment variable that holds key version `v`. */
function keyVariableFor(v: number): string {
  return v === 1 ? "SETTINGS_ENCRYPTION_KEY" : `SETTINGS_ENCRYPTION_KEY_V${v}`;
}

function noteMissingVersion(v: number) {
  if (missingVersions.has(v)) return;
  missingVersions.add(v);
  // Names and numbers only.
  console.error(
    `Saved values use key version ${v}, but ${keyVariableFor(v)} is not set on this server. ` +
      "They are kept and reported as saved, not as unreadable."
  );
}

/** The key ring, or null when the key is missing or malformed (logged once, by variable name). */
export function tryKeyRing(): KeyRing | null {
  return loadKeyRing().ring;
}

/** The key ring, or a 503 EncryptionNotConfiguredError with this message. */
export function requireKeyRing(message?: string): KeyRing {
  const ring = tryKeyRing();
  if (!ring) throw new EncryptionNotConfiguredError(message);
  return ring;
}

/** What the admin-only debug answer shows about the key. Never the key itself. */
export function keyStatus(): {
  configured: boolean;
  version: number | null;
  fingerprint: string | null;
  problem: string | null;
  missingKeyVersions: number[];
} {
  const { ring, problem } = loadKeyRing();
  const missingKeyVersions = [...missingVersions].sort((a, b) => a - b);
  if (!ring) return { configured: false, version: null, fingerprint: null, problem, missingKeyVersions };
  return {
    configured: true,
    version: ring.current,
    fingerprint: currentFingerprint(ring),
    problem: null,
    missingKeyVersions,
  };
}

export type SecretRead =
  | { state: "blank" }
  | { state: "readable"; value: string; legacy: boolean }
  // The key version is configured and the value does not decrypt (tampered,
  // other key, other context), or the value is malformed.
  | { state: "unreadable" }
  // An encrypted value, but this server has no key, or not the key version
  // the value asks for: the value may be fine.
  | { state: "locked" };

/**
 * Read a stored secret. Legacy plain-text values are returned as they are.
 * An encrypted value needs the key: without it, or without the key version
 * the value asks for, the answer is "locked" (the value may be fine); when
 * the version is configured but it does not decrypt, "unreadable".
 */
function readStored(stored: string | null | undefined, context: string, ring: KeyRing | null): SecretRead {
  if (isBlank(stored)) return { state: "blank" };
  const text = stored as string;
  if (!isEncrypted(text)) return { state: "readable", value: text, legacy: true };
  if (!ring) return { state: "locked" };
  const version = versionOf(text);
  if (version !== null && !ring.keys.has(version)) {
    noteMissingVersion(version);
    return { state: "locked" };
  }
  try {
    return { state: "readable", value: decrypt(ring, text, context), legacy: false };
  } catch {
    return { state: "unreadable" };
  }
}

/** Read a stored setting value for its owner. Never throws for a missing key. */
export function readSettingValue(userId: string, key: string, stored: string | null | undefined): SecretRead {
  return readStored(stored, settingContext(userId, key), tryKeyRing());
}

/** Encrypt a setting value for its owner. Throws 503 when the key is not configured. */
export function encryptSettingValue(ring: KeyRing, userId: string, key: string, plaintext: string): string {
  return encrypt(ring, plaintext, settingContext(userId, key));
}

export type TokenColumn = "access_token" | "refresh_token";

/** Encrypt a Google token for its owner. */
export function encryptToken(ring: KeyRing, userId: string, column: TokenColumn, plaintext: string): string {
  return encrypt(ring, plaintext, tokenContext(userId, column));
}

/** Read a stored Google token for its owner (legacy plain text is returned as is). */
export function readToken(ring: KeyRing, userId: string, column: TokenColumn, stored: string): SecretRead {
  return readStored(stored, tokenContext(userId, column), ring);
}

/**
 * The real value of a secret setting, for server code that must call a
 * third party (Twilio, skip tracing). Null when not set or not readable.
 * Never send the result to the browser. Nothing calls this yet.
 */
export async function getSecretSetting(userId: string, key: string): Promise<string | null> {
  if (!userId) throw new Error("getSecretSetting needs a user id");
  // Reserved (server-only) and public names are refused: isSecretSetting is false for both.
  if (!isSecretSetting(key)) throw new Error("getSecretSetting is for secret settings only");
  const [row] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)))
    .limit(1);
  if (!row) return null;
  const read = readSettingValue(userId, key, row.value);
  if (read.state === "unreadable") {
    // Only a real decrypt failure is logged; a missing key ("locked") is logged once elsewhere.
    // The name is user text: JSON.stringify keeps it on one line.
    console.error(`Saved setting could not be decrypted: user ${userId}, key ${JSON.stringify(key)}.`);
    return null;
  }
  return read.state === "readable" ? read.value.trim() || null : null;
}
