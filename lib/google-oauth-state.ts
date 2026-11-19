import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Google OAuth "state" for the Calendar connect flow.
//
// state   = base64url(JSON payload) + "." + base64url(HMAC-SHA256(key, base64url(JSON payload)))
// payload = { u: signed-in user id, exp: expiry (Unix seconds, 10 minutes ahead),
//             nh: hex SHA-256 of a random 32 byte nonce }
// key     = HMAC-SHA256(key = GOOGLE_CLIENT_SECRET, message = KEY_LABEL)
//
// The raw nonce goes in an httpOnly cookie limited to the callback path, so a
// state only works in the browser that started the flow, for the user who
// started it. tests/helpers/oauth.mjs mints states the same way.
//
// Single use is enforced on the server too: starting a flow stores the nonce
// hash as the user's one pending marker (a settings row with a reserved key),
// and the callback deletes that row before doing anything else. A replayed or
// superseded state finds no row and is refused.

const KEY_LABEL = "re-crm/google-oauth-state/v1";
export const NONCE_COOKIE = "google_oauth_nonce";
export const NONCE_COOKIE_PATH = "/api/calendar/google/callback";
export const STATE_TTL_SECONDS = 10 * 60;
/** Settings key of the pending-flow marker. Keys starting with "_" are server-only. */
export const OAUTH_PENDING_KEY = "_google_oauth_pending";

function signingKey(): Buffer | null {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** The nonce hash carried in the state and stored as the pending marker. */
export function nonceHash(nonce: string) {
  return sha256Hex(nonce);
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A new state for this user plus the nonce for the cookie. Null if Google is not configured. */
export function createOAuthState(userId: string): { state: string; nonce: string } | null {
  const key = signingKey();
  if (!key) return null;
  const nonce = randomBytes(32).toString("base64url");
  const payload = {
    u: userId,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    nh: sha256Hex(nonce),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(payloadB64).digest("base64url");
  return { state: `${payloadB64}.${sig}`, nonce };
}

/** True only for a state this server signed, not expired, for this user, matching the cookie nonce. */
export function verifyOAuthState(
  state: string | null,
  nonce: string | undefined,
  userId: string
): boolean {
  const key = signingKey();
  if (!key || !state || !nonce || state.length > 1024 || nonce.length > 256) return false;
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [payloadB64, sig] = parts;
  const expected = createHmac("sha256", key).update(payloadB64).digest("base64url");
  if (!safeEqual(sig, expected)) return false;

  let payload: { u?: unknown; exp?: unknown; nh?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (typeof payload.u !== "string" || typeof payload.exp !== "number" || typeof payload.nh !== "string") {
    return false;
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) return false;
  if (!safeEqual(payload.u, userId)) return false;
  return safeEqual(payload.nh, sha256Hex(nonce));
}

/** Cookie settings for the nonce. maxAge 0 clears it. */
export function nonceCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: NONCE_COOKIE_PATH,
    maxAge,
  };
}
