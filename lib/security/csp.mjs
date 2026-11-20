// The Content Security Policy (CSP) for every page of the app.
//
// The policy tells the browser what a page may load and run. Script files
// run only when they come from this site. Inline scripts run only when they
// carry the nonce, a random value made new for every page request (proxy.ts
// makes it and Next.js adds it to its own script tags). An injected inline
// script has no nonce, and a script file from another site is refused, so
// neither can run.
//
// To allow a new outside service, add its host to the right line here and
// update the tests that list the policy (tests/t30-csp-policy.test.mjs and
// the page test tests/t31-csp-pages.test.mjs).
//
// Plain Node ESM with JSDoc types, shared by proxy.ts and the tests. No
// Next.js imports here.

/**
 * The one switch for the rollout. True: the browser blocks what the policy
 * does not allow (enforcing). False: it only reports it (report-only).
 */
export const ENFORCE = true;

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
 * A new nonce, as in the Next.js guide: a new random value for every
 * request, in base64. 18 random bytes (144 bits) from Web Crypto.
 * @returns {string}
 */
export function makeNonce() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
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
    // The example in the Next.js guide also has 'strict-dynamic'; it is left
    // out here because this app loads all of its script from its own origin.
    // Without it, a script that other script creates still needs the nonce,
    // and script from outside is refused.
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
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
