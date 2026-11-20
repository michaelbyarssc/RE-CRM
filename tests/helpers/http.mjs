// HTTP client for the black-box tests.
//
// Builds Supabase session cookies in the format @supabase/ssr 0.10 reads:
// cookie name "sb-<first label of the Supabase host>-auth-token", value
// "base64-" + base64url(JSON session). The session expires far in the future,
// so the client never tries to refresh it.

import { appendFileSync } from "node:fs";
import { tokenFor } from "./auth-stub.mjs";

const APP_URL = process.env.TEST_APP_URL;
const AUTH_URL = process.env.TEST_AUTH_URL;
const RESPONSE_LOG = process.env.TEST_RESPONSE_LOG;

export function appUrl() {
  if (!APP_URL) throw new Error("TEST_APP_URL is not set: run the tests with npm test");
  return APP_URL;
}

export function sessionCookieName() {
  const host = new URL(AUTH_URL).hostname;
  return `sb-${host.split(".")[0]}-auth-token`;
}

export function sessionCookie(user) {
  const session = {
    access_token: tokenFor(user),
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4102444800, // 2100-01-01
    user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated" },
  };
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${sessionCookieName()}=${value}`;
}

/**
 * Send a request to the app.
 * opts: { user, method, body (object, or string sent as is), headers, cookies: [..], base, timeoutMs }
 */
export async function api(path, opts = {}) {
  const method = opts.method || "GET";
  const headers = { ...(opts.headers || {}) };
  const cookies = [...(opts.cookies || [])];
  if (opts.user) cookies.push(sessionCookie(opts.user));
  if (cookies.length) headers.cookie = cookies.join("; ");
  let body;
  if (opts.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof opts.body === "string") {
      body = opts.body;
    } else {
      body = JSON.stringify(opts.body);
    }
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }
  }
  const started = Date.now();
  const res = await fetch((opts.base || appUrl()) + path, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  const result = {
    status: res.status,
    headers: res.headers,
    text,
    json,
    ms: Date.now() - started,
    location: res.headers.get("location"),
    setCookies: res.headers.getSetCookie(),
  };
  if (RESPONSE_LOG) {
    appendFileSync(
      RESPONSE_LOG,
      JSON.stringify({
        method,
        path,
        status: res.status,
        body: text.slice(0, 20000),
        location: result.location,
        setCookies: result.setCookies,
      }) + "\n"
    );
  }
  return result;
}

/** Wait until the app answers again (used after a test that may have blocked it). */
export async function waitForApp(maxMs = 240_000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(appUrl() + "/api/auth/me", { signal: AbortSignal.timeout(5000) });
      await res.text();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

/** True if any of the markers appears in the text (case-insensitive). */
export function findMarkers(text, markers) {
  const lower = text.toLowerCase();
  return markers.filter((m) => lower.includes(String(m).toLowerCase()));
}
