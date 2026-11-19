// Which settings are secret, and where each saved secret "lives".
//
// Plain Node ESM with JSDoc types, shared by the app, the one-off script
// and the tests, so the rules exist once.

// A setting name is one of three kinds:
// - reserved (server-only): starts with RESERVED_SETTING_PREFIX, for example
//   the Google connect marker "_google_oauth_pending". Written only by server
//   code, kept as plain text, never returned by GET /api/settings, never
//   accepted from the browser, never encrypted by the one-off script.
// - public: in PUBLIC_SETTING_KEYS, shown in the browser.
// - secret: every other name.

/** Setting names starting with this are reserved for the server. */
export const RESERVED_SETTING_PREFIX = "_";

/**
 * The reserved names this app writes itself. Today only the Google connect
 * marker. The same literal is OAUTH_PENDING_KEY in lib/google-oauth-state.ts,
 * which is server-only and cannot be imported by plain Node scripts; a test
 * (T44) checks that the two stay equal.
 */
export const SERVER_WRITTEN_SETTING_KEYS = Object.freeze(["_google_oauth_pending"]);

/**
 * Settings whose value may be shown in the browser. Every other key that is
 * not reserved is a secret, including keys nobody has defined yet: a setting
 * someone forgets to classify is then hidden and encrypted instead of leaked.
 */
export const PUBLIC_SETTING_KEYS = Object.freeze(["twilio_phone_number"]);

/** The Google token columns that are encrypted. */
export const TOKEN_COLUMNS = Object.freeze(["access_token", "refresh_token"]);

/** Secrets shorter than this show as set, with no last 4 characters. */
export const LAST4_MIN_LENGTH = 12;

/**
 * True for a server-only setting name (it starts with "_", which includes "__proto__").
 * @param {string} key
 * @returns {boolean}
 */
export function isReservedSetting(key) {
  return typeof key === "string" && key.startsWith(RESERVED_SETTING_PREFIX);
}

/**
 * True for a secret setting: not reserved and not public.
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretSetting(key) {
  return !isReservedSetting(key) && !PUBLIC_SETTING_KEYS.includes(key);
}

/**
 * The context (additional authenticated data) of a saved setting.
 * @param {string} userId
 * @param {string} key
 * @returns {string}
 */
export function settingContext(userId, key) {
  if (!userId || !key) throw new TypeError("settingContext needs a user id and a key");
  return JSON.stringify(["settings", userId, key]);
}

/**
 * The context (additional authenticated data) of a Google token column.
 * @param {string} userId
 * @param {"access_token" | "refresh_token"} column
 * @returns {string}
 */
export function tokenContext(userId, column) {
  if (!userId || !TOKEN_COLUMNS.includes(column)) {
    throw new TypeError("tokenContext needs a user id and a token column");
  }
  return JSON.stringify(["google_calendar_tokens", userId, column]);
}

/**
 * True for null, undefined, "" and text that is only white space.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

/**
 * The last 4 characters of a secret, or null when it is shorter than
 * LAST4_MIN_LENGTH (4 characters of a short secret would give away too much).
 * White space at either end is ignored.
 * @param {string} plaintext
 * @returns {string | null}
 */
export function lastFour(plaintext) {
  const text = typeof plaintext === "string" ? plaintext.trim() : "";
  const chars = Array.from(text);
  if (chars.length < LAST4_MIN_LENGTH) return null;
  return chars.slice(-4).join("");
}
