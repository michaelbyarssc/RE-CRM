// The Content Security Policy (CSP) for every page of the app.
//
// The policy tells the browser what a page may load and run. Scripts run
// only when they come from this site and carry the nonce, a random value
// made new for every page request (proxy.ts makes it and Next.js adds it to
// its own script tags). An injected script has no nonce, so it cannot run.
//
// To allow a new outside service, add its host to the right line here and
// update the test that lists the policy (tests/t30-csp-policy.test.mjs).
//
// Plain Node ESM with JSDoc types, shared by proxy.ts and the tests. No
// Next.js imports here.

/**
 * The one switch for the rollout. While false, the browser only reports
 * what the policy would block (report-only). When true, it blocks it.
 */
export const ENFORCE = false;

/** The header the page policy is sent in. */
export const POLICY_HEADER = ENFORCE
  ? "Content-Security-Policy"
  : "Content-Security-Policy-Report-Only";

/** The other policy header name. The proxy removes it from incoming requests. */
export const OTHER_POLICY_HEADER = ENFORCE
  ? "Content-Security-Policy-Report-Only"
  : "Content-Security-Policy";

/** The OpenStreetMap tile servers the map loads its pictures from. */
const TILE_HOSTS = [
  "https://a.tile.openstreetmap.org",
  "https://b.tile.openstreetmap.org",
  "https://c.tile.openstreetmap.org",
];

// Plain base64 only: letters, digits, "+" and "/", padded to a multiple of 4.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// What a safe origin looks like once the URL parser has made it: scheme,
// host (letters, digits, dots and dashes, or an IPv6 address in brackets)
// and an optional port. Nothing that could end a source or a directive.
const SAFE_ORIGIN = /^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?$/;

/**
 * A new nonce, the way the Next.js guide makes it: a random UUID in base64.
 * @returns {string}
 */
export function makeNonce() {
  return Buffer.from(globalThis.crypto.randomUUID()).toString("base64");
}

/**
 * The origin of the Supabase project address, or null when the value is
 * missing, empty, not a valid address, not http or https, or would not be
 * a single clean source in the policy.
 * @param {unknown} value
 * @returns {string | null}
 */
export function supabaseOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const origin = url.origin;
  return SAFE_ORIGIN.test(origin) ? origin : null;
}

/**
 * The page policy as one header value, directives joined with "; ".
 * @param {{ nonce: string, isDev?: boolean, supabaseUrl?: string | null }} options
 * @returns {string}
 */
export function buildPagePolicy({ nonce, isDev = false, supabaseUrl } = /** @type {any} */ ({})) {
  if (typeof nonce !== "string" || nonce === "" || !BASE64.test(nonce)) {
    throw new TypeError("The nonce must be plain base64");
  }
  const supabase = supabaseOrigin(supabaseUrl);
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Leaflet, FullCalendar and the UI kit set inline styles. No nonce here:
    // a nonce in style-src makes browsers ignore 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${TILE_HOSTS.join(" ")}`,
    // FullCalendar's arrow icons are a font inside its CSS (a data: address).
    "font-src 'self' data:",
    // The browser talks to Supabase for sign-in and sign-out only.
    `connect-src 'self'${supabase ? ` ${supabase}` : ""}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}
