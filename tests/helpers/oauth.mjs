// Mints Google OAuth state values the same way lib/google-oauth-state.ts does,
// so the tests can build expired or tampered states with the dummy secret.
//
// Documented format:
//   key   = HMAC-SHA256(key = GOOGLE_CLIENT_SECRET, message = KEY_LABEL)
//   state = base64url(JSON payload) + "." + base64url(HMAC-SHA256(key, base64url(JSON payload)))
//   payload = { u: user id, exp: expiry in Unix seconds, nh: hex SHA-256 of the nonce }
// The raw nonce travels in the NONCE_COOKIE cookie.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { GOOGLE_CLIENT_SECRET } from "./config.mjs";

export const KEY_LABEL = "re-crm/google-oauth-state/v1";
export const NONCE_COOKIE = "google_oauth_nonce";

export function signingKey(secret = GOOGLE_CLIENT_SECRET) {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

export function sign(payloadB64, secret) {
  return createHmac("sha256", signingKey(secret)).update(payloadB64).digest("base64url");
}

export function mintState({ userId, expSeconds, nonce = randomBytes(32).toString("base64url"), secret }) {
  const payload = {
    u: userId,
    exp: expSeconds ?? Math.floor(Date.now() / 1000) + 600,
    nh: createHash("sha256").update(nonce).digest("hex"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: `${payloadB64}.${sign(payloadB64, secret)}`, nonce, payload };
}

/** The cookie value set by the app, from a list of Set-Cookie headers. */
export function nonceFromSetCookies(setCookies) {
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const [name, ...rest] = pair.split("=");
    if (name.trim() === NONCE_COOKIE) return rest.join("=");
  }
  return null;
}

export function findSetCookie(setCookies, name) {
  return setCookies.find((c) => c.split("=")[0].trim() === name) || null;
}
