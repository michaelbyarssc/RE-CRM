#!/usr/bin/env node
// One-off: encrypt the secrets that were saved before encryption existed.
//
// Usage:
//   node --env-file=.env.local scripts/encrypt-existing-secrets.mjs
//       dry run: changes nothing
//   node --env-file=.env.local scripts/encrypt-existing-secrets.mjs --apply --expect-fingerprint=<8 hex>
//       makes the changes
//   npm run db:encrypt-secrets -- --apply --expect-fingerprint=<8 hex>
//       the same, with the variables already set in the shell
//
// Reads DATABASE_URL and SETTINGS_ENCRYPTION_KEY (plus SETTINGS_ENCRYPTION_KEY_V2
// and up, if present) from the environment. Prints counts and row ids only,
// never a value.
//
// --apply needs --expect-fingerprint=<8 hex characters> (or
// --expect-fingerprint <value>): the fingerprint of the key THE APP uses, from
// the app's admin debug answer (GET /api/calendar/google?action=debug, field
// settingsKey.fingerprint). This script never prints the fingerprint of its
// own key, so the app is the only place a passing value can come from. If it
// does not match the key here, nothing is changed and the script exits with
// code 2. Without this check, a first run on plain-text rows with a wrong key would
// encrypt everything with a key the app does not have. The dry run checks the
// value too when it is given, so it can be tested first.
//
// Looks at every settings row whose key is a secret and both token columns of
// every google_calendar_tokens row. Plain text is encrypted with the current
// key; a value encrypted with an older key that is still configured is
// re-encrypted. If any encrypted value cannot be read with the configured
// keys, nothing is changed and the script exits with code 2.
//
// Rows with no owner (user_id is empty) cannot be encrypted, because the
// value is bound to its owner. The app never reads them. If any of them holds
// a plain-text secret, the script lists them and exits with code 3, on every
// run, until they are deleted or given an owner
// (npm run db:migrate -- --assign-unowned-to <email>, then run this again;
// that command also updates the schema and applies the lockdown file, so on
// the live database it needs the owner's go-ahead first).
//
// --apply runs in one transaction. Each new value is decrypted again and
// compared before it is written, and each update only applies if the row
// still holds the value that was read (a row changed in the meantime is left
// for the next run). updated_at is not changed. Safe to run more than once.
//
// Exit codes: 0 ok; 1 usage or configuration error; 2 wrong key (fingerprint
// mismatch, or values that cannot be read with the configured keys); 3 some
// plain-text values could not be encrypted because their row has no owner.

import postgres from "postgres";
import { describeTarget } from "./lib/migrations.mjs";
import {
  SecretsConfigError,
  currentFingerprint,
  decrypt,
  encrypt,
  isEncrypted,
  keyRingFromEnv,
  versionOf,
} from "../lib/secrets/box.mjs";
import {
  SERVER_WRITTEN_SETTING_KEYS,
  TOKEN_COLUMNS,
  isBlank,
  isReservedSetting,
  isSecretSetting,
  settingContext,
  tokenContext,
} from "../lib/secrets/policy.mjs";

const DEBUG_SOURCE =
  "the app's admin debug answer (GET /api/calendar/google?action=debug, field settingsKey.fingerprint)";

const USAGE = `Usage: node --env-file=.env.local scripts/encrypt-existing-secrets.mjs [--apply --expect-fingerprint=<8 hex>]

  (no option)                  dry run: report what would change, change nothing
  --apply                      encrypt the plain-text values (one transaction)
  --expect-fingerprint=<hex>   required with --apply: the 8 character fingerprint of the key
                               the APP uses, from ${DEBUG_SOURCE}.
                               This script never prints a fingerprint itself. Also checked in a dry run.
  --help                       show this text

Needs DATABASE_URL and SETTINGS_ENCRYPTION_KEY in the environment.
Exit codes: 0 ok; 1 usage or configuration error; 2 wrong key (fingerprint mismatch, or values
that cannot be read with this key); 3 some plain-text values could not be encrypted because
their row has no owner.`;

class UsageError extends Error {}

// Set once the --apply transaction has committed, so a later failure (for
// example during the check afterwards) is not reported as "nothing changed".
let committed = false;

function parseArgs(argv) {
  const args = { apply: false, help: false, expect: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--expect-fingerprint") {
      if (i + 1 >= argv.length) throw new UsageError("--expect-fingerprint needs a value");
      args.expect = argv[++i];
    } else if (a.startsWith("--expect-fingerprint=")) args.expect = a.slice("--expect-fingerprint=".length);
    else throw new UsageError(`Unknown option: ${a}`);
  }
  if (args.expect !== null && !/^[0-9a-f]{8}$/i.test(args.expect)) {
    throw new UsageError(`--expect-fingerprint must be 8 hex characters, as shown in ${DEBUG_SOURCE}.`);
  }
  return args;
}

const CATEGORIES = [
  ["encrypt", "to encrypt (plain text)"],
  ["reencrypt", "to re-encrypt (encrypted with an older key version)"],
  ["current", "already encrypted with the current key"],
  ["public", "public settings, skipped"],
  ["reserved", "server-only settings (names starting with _), skipped"],
  ["blank", "empty, skipped"],
  ["ownerless", "no owner (user_id is empty), skipped"],
  ["unreadable", "NOT readable with the configured keys"],
];
const LIST_IDS = new Set(["ownerless", "unreadable"]);
// Count lines that cannot apply to the Google section are not printed there.
const SETTINGS_ONLY = new Set(["public", "reserved"]);

/** The environment variable that holds key version `v`. */
function keyVariableFor(v) {
  return v === 1 ? "SETTINGS_ENCRYPTION_KEY" : `SETTINGS_ENCRYPTION_KEY_V${v}`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Sort one stored value into a category. For "encrypt" and "reencrypt" the
 * plain text is returned too (kept in memory only, never printed).
 */
function classify(ring, { stored, userId, context, isPublic, isReserved }) {
  // Server-only rows (for example the Google connect marker) must stay plain text.
  if (isReserved) return { category: "reserved" };
  if (isPublic) return { category: "public" };
  if (isBlank(stored)) return { category: "blank" };
  if (!userId) return { category: "ownerless" };
  if (!isEncrypted(stored)) return { category: "encrypt", plaintext: stored };
  let plaintext;
  try {
    plaintext = decrypt(ring, stored, context);
  } catch {
    return { category: "unreadable" };
  }
  if (versionOf(stored) === ring.current) return { category: "current" };
  return { category: "reencrypt", plaintext };
}

function newCounts() {
  return Object.fromEntries(CATEGORIES.map(([c]) => [c, []]));
}

const MAX_NAMES_SHOWN = 20;

/** A setting name for output: as is when it is plain, quoted with JSON.stringify otherwise (old rows can have odd names). */
function showName(name) {
  return /^[A-Za-z0-9_.-]+$/.test(name) ? name : JSON.stringify(name);
}

/** Up to 20 names, then "and N more". Names are not secret. */
function nameList(names) {
  const shown = names.slice(0, MAX_NAMES_SHOWN).map(showName).join(", ");
  return names.length > MAX_NAMES_SHOWN ? `${shown} and ${names.length - MAX_NAMES_SHOWN} more` : shown;
}

/** `names` maps a category to the distinct setting names to list after its count. */
function report(title, counts, { settingsOnly = true, names = {} } = {}) {
  console.log(title);
  for (const [category, label] of CATEGORIES) {
    if (!settingsOnly && SETTINGS_ONLY.has(category)) continue;
    const ids = counts[category];
    let list = LIST_IDS.has(category) && ids.length ? ` (ids ${[...new Set(ids)].join(", ")})` : "";
    if (names[category]?.length) list = ` (${nameList(names[category])})`;
    console.log(`  ${label}: ${ids.length}${list}`);
  }
}

/**
 * A reserved name the app does not write itself may be an old row someone
 * saved through the API directly. It is skipped like every reserved row, so
 * say plainly that it is still plain text and what to do.
 */
function noteUnknownReserved(names) {
  const unknown = names.filter((n) => !SERVER_WRITTEN_SETTING_KEYS.includes(n));
  if (!unknown.length) return;
  const one = unknown.length === 1;
  console.log(
    `Note: ${unknown.length} server-only ${one ? "name is" : "names are"} not one this app writes itself: ` +
      `${nameList(unknown)}. If ${one ? "it holds" : "they hold"} a key someone saved, ${one ? "it is" : "they are"} ` +
      `still plain text. Delete ${one ? "that row" : "those rows"} or rename ${one ? "it" : "them"} ` +
      `(the app only writes: ${SERVER_WRITTEN_SETTING_KEYS.join(", ")}).`
  );
}

async function collect(sql, ring) {
  const settingsCounts = newCounts();
  const tokenCounts = newCounts();
  const work = [];
  const unreadable = [];
  const ownerlessPlain = [];

  const settingsRows = await sql`SELECT id, user_id, key, value FROM settings ORDER BY id`;
  const reservedNames = [];
  for (const row of settingsRows) {
    const isReserved = isReservedSetting(row.key);
    if (isReserved && !reservedNames.includes(row.key)) reservedNames.push(row.key);
    const isPublic = !isReserved && !isSecretSetting(row.key);
    const context = row.user_id && isSecretSetting(row.key) ? settingContext(row.user_id, row.key) : null;
    const c = classify(ring, { stored: row.value, userId: row.user_id, context, isPublic, isReserved });
    settingsCounts[c.category].push(row.id);
    if (c.category === "unreadable") unreadable.push({ label: `settings ${row.id}`, version: versionOf(row.value) });
    if (c.category === "ownerless" && !isEncrypted(row.value)) ownerlessPlain.push(`settings ${row.id}`);
    if (c.plaintext !== undefined) {
      work.push({ kind: c.category, table: "settings", column: "value", id: row.id, old: row.value, plaintext: c.plaintext, context });
    }
  }

  const tokenRows = await sql`SELECT id, user_id, access_token, refresh_token FROM google_calendar_tokens ORDER BY id`;
  for (const row of tokenRows) {
    for (const column of TOKEN_COLUMNS) {
      const context = row.user_id ? tokenContext(row.user_id, column) : null;
      const c = classify(ring, { stored: row[column], userId: row.user_id, context, isPublic: false });
      tokenCounts[c.category].push(row.id);
      if (c.category === "unreadable") {
        unreadable.push({ label: `google_calendar_tokens ${row.id} ${column}`, version: versionOf(row[column]) });
      }
      if (c.category === "ownerless" && !isEncrypted(row[column])) {
        ownerlessPlain.push(`google_calendar_tokens ${row.id} ${column}`);
      }
      if (c.plaintext !== undefined) {
        work.push({ kind: c.category, table: "google_calendar_tokens", column, id: row.id, old: row[column], plaintext: c.plaintext, context });
      }
    }
  }

  report(`Saved keys (settings table): ${plural(settingsRows.length, "row", "rows")} looked at`, settingsCounts, {
    names: { reserved: reservedNames },
  });
  noteUnknownReserved(reservedNames);
  report(
    `Google Calendar connections (google_calendar_tokens table): ${plural(tokenRows.length, "row", "rows")} ` +
      `(${tokenRows.length * 2} values) looked at`,
    tokenCounts,
    { settingsOnly: false }
  );
  return { work, unreadable, ownerlessPlain };
}

/** "2 value(s) to encrypt and 1 to re-encrypt" style counts of a work list. */
function workCounts(items) {
  const encrypt = items.filter((w) => w.kind === "encrypt").length;
  return { encrypt, reencrypt: items.length - encrypt };
}

async function apply(sql, ring, work) {
  let written = 0;
  const writtenItems = [];
  let changedDuringRun = 0;
  const changedIds = [];
  await sql.begin(async (tx) => {
    for (const item of work) {
      const next = encrypt(ring, item.plaintext, item.context);
      // Check in memory before anything is written.
      if (decrypt(ring, next, item.context) !== item.plaintext) {
        throw new Error(`Self-check failed for ${item.table} row ${item.id}; nothing was changed`);
      }
      // Compare and swap: only if the row still holds the value that was read.
      const result = await tx`
        UPDATE ${tx(item.table)} SET ${tx(item.column)} = ${next}
        WHERE id = ${item.id} AND ${tx(item.column)} = ${item.old}`;
      if (result.count === 1) {
        written++;
        writtenItems.push(item);
      } else {
        changedDuringRun++;
        changedIds.push(`${item.table} ${item.id}`);
      }
    }
  });
  return { written, writtenItems, changedDuringRun, changedIds };
}

/** After the commit: every encrypted value must decrypt with the configured keys. */
async function verify(sql, ring) {
  let checked = 0;
  const problems = [];
  const plainLeft = [];
  const ownerlessPlain = [];
  const settingsRows = await sql`SELECT id, user_id, key, value FROM settings ORDER BY id`;
  for (const row of settingsRows) {
    if (!isSecretSetting(row.key) || isBlank(row.value)) continue;
    if (!row.user_id) {
      if (!isEncrypted(row.value)) ownerlessPlain.push(`settings ${row.id}`);
      continue;
    }
    if (!isEncrypted(row.value)) {
      plainLeft.push(`settings ${row.id}`);
      continue;
    }
    try {
      decrypt(ring, row.value, settingContext(row.user_id, row.key));
      checked++;
    } catch {
      problems.push(`settings ${row.id}`);
    }
  }
  const tokenRows = await sql`SELECT id, user_id, access_token, refresh_token FROM google_calendar_tokens ORDER BY id`;
  for (const row of tokenRows) {
    for (const column of TOKEN_COLUMNS) {
      if (isBlank(row[column])) continue;
      if (!row.user_id) {
        if (!isEncrypted(row[column])) ownerlessPlain.push(`google_calendar_tokens ${row.id} ${column}`);
        continue;
      }
      if (!isEncrypted(row[column])) {
        plainLeft.push(`google_calendar_tokens ${row.id} ${column}`);
        continue;
      }
      try {
        decrypt(ring, row[column], tokenContext(row.user_id, column));
        checked++;
      } catch {
        problems.push(`google_calendar_tokens ${row.id} ${column}`);
      }
    }
  }
  return { checked, problems, plainLeft, ownerlessPlain };
}

/**
 * Explain why encrypted values cannot be read. Two different causes:
 * (a) the key version they were encrypted with is not configured here (for
 *     example SETTINGS_ENCRYPTION_KEY_V2 was renamed back after a rotation);
 * (b) the version is configured, but the value does not decrypt with it
 *     (the wrong key, or a damaged value).
 */
function reportUnreadable(ring, unreadable) {
  console.error(`Stopped: ${unreadable.length} encrypted value(s) cannot be read here. Nothing was changed.`);
  const missing = new Map();
  const wrong = [];
  for (const u of unreadable) {
    if (u.version !== null && !ring.keys.has(u.version)) {
      if (!missing.has(u.version)) missing.set(u.version, []);
      missing.get(u.version).push(u.label);
    } else {
      wrong.push(u.label);
    }
  }
  for (const [v, labels] of [...missing].sort((a, b) => a[0] - b[0])) {
    console.error(
      `- ${labels.length} value(s) were encrypted with key version ${v}, but ${keyVariableFor(v)} is not set here: ` +
        `${labels.join(", ")}.`
    );
  }
  if (missing.size) {
    console.error(
      "  The version number is stored with every value, so each key must keep the variable name it had " +
        "(a renamed key looks like a missing one). Set the missing variable(s) and run this again."
    );
  }
  if (wrong.length) {
    console.error(
      `- ${wrong.length} value(s) use a key version that is set here but do not decrypt: the key here does not match ` +
        `the key that encrypted them, or the values are damaged: ${wrong.join(", ")}.`
    );
    console.error("  Check the key against the fingerprint in the app's admin debug answer.");
  }
}

/** Warn about plain-text secrets in rows with no owner. Returns the exit code: 3 if any, else 0. */
function reportOwnerless(list) {
  if (!list.length) return 0;
  console.error(
    `Warning: ${list.length} plain-text secret value(s) could not be encrypted because their row has no owner: ${list.join(", ")}. ` +
      "The app never reads these rows. Delete them, or give them an owner " +
      "(npm run db:migrate -- --assign-unowned-to <email>, which also updates the schema and applies the lockdown " +
      "file: on the live database, get the owner's go-ahead first) and run this script again."
  );
  return 3;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Example: node --env-file=.env.local scripts/encrypt-existing-secrets.mjs");
    return 1;
  }
  let ring;
  try {
    ring = keyRingFromEnv(process.env);
  } catch (err) {
    if (err instanceof SecretsConfigError) {
      console.error(`Configuration error: ${err.message}`);
      return 1;
    }
    throw err;
  }

  const target = describeTarget(url);
  // The fingerprint of the key here is never printed: the only way to get a
  // value that passes the check below must be the app's admin debug answer.
  const here = currentFingerprint(ring);
  console.log(`Target: database "${target.database}" on host ${target.host}:${target.port}`);
  console.log(`Encryption key here: version ${ring.current}`);
  console.log(
    args.apply
      ? "Mode: --apply (changes are made in one transaction)"
      : "Mode: dry run (nothing will be changed)"
  );

  // The fingerprint check comes before the database is even opened.
  if (args.apply && args.expect === null) {
    console.error(
      `--apply needs --expect-fingerprint=<8 hex characters>: the fingerprint of the key the app uses, from ${DEBUG_SOURCE}. ` +
        "This script never shows a fingerprint itself: the point is to prove that the key here is the app's key. Nothing was changed."
    );
    return 1;
  }
  if (args.expect !== null) {
    const expected = args.expect.toLowerCase();
    if (expected !== here) {
      console.error(
        `Stopped: the key here does not match the expected fingerprint ${expected}, so it is NOT the key the app uses. ` +
          "Use the same SETTINGS_ENCRYPTION_KEY as the app (and check the value against the app's admin debug answer). " +
          "Nothing was changed."
      );
      return 2;
    }
    console.log(`Fingerprint check: the key here matches the expected fingerprint ${expected}.`);
  }
  console.log("");

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const { work, unreadable, ownerlessPlain } = await collect(sql, ring);
    console.log("");

    if (unreadable.length) {
      reportUnreadable(ring, unreadable);
      return 2;
    }

    if (work.length === 0) {
      console.log("Nothing to do: every secret that has an owner is already encrypted with the current key.");
      return reportOwnerless(ownerlessPlain);
    }
    if (!args.apply) {
      const n = workCounts(work);
      console.log(
        `Dry run: ${n.encrypt} plain-text value(s) would be encrypted and ${n.reencrypt} value(s) ` +
          "re-encrypted with the current key version. Nothing was changed."
      );
      if (args.expect !== null) {
        // The fingerprint given already matched (a mismatch stopped above).
        console.log(`Next: run again with --apply --expect-fingerprint=${args.expect.toLowerCase()}`);
      } else {
        console.log(
          "Next: read the fingerprint from " +
            `${DEBUG_SOURCE}. Optionally test it with a dry run plus --expect-fingerprint=<fingerprint>, ` +
            "then run again with --apply --expect-fingerprint=<fingerprint>."
        );
      }
      return reportOwnerless(ownerlessPlain);
    }

    const result = await apply(sql, ring, work);
    committed = true;
    const n = workCounts(result.writtenItems);
    console.log(
      `Saved: ${n.encrypt} plain-text value(s) were encrypted and ${n.reencrypt} value(s) ` +
        "re-encrypted with the current key version."
    );
    console.log(
      `Rows changed during the run (left for the next run): ${result.changedDuringRun}` +
        (result.changedIds.length ? ` (${result.changedIds.join(", ")})` : "")
    );

    const check = await verify(sql, ring);
    console.log(`Checked after saving: ${check.checked} encrypted value(s) decrypt with the configured key(s).`);
    if (check.plainLeft.length) {
      console.log(`Still plain text (run the script again): ${check.plainLeft.join(", ")}`);
    }
    if (check.problems.length) {
      console.error(`Problem: these values do not decrypt: ${check.problems.join(", ")}`);
      return 2;
    }
    return reportOwnerless(check.ownerlessPlain);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof UsageError) {
      console.error(err.message);
      console.error(USAGE);
      process.exit(1);
    }
    // A database error message can quote data, so print only its code.
    const detail = err && err.name === "PostgresError" ? `database error ${err.code}` : err && err.message;
    if (committed) {
      console.error(
        `The changes were saved, but the check afterwards did not finish: ${detail}. ` +
          "Run the dry run again to confirm the result."
      );
    } else {
      console.error(`Failed, nothing was changed: ${detail}`);
    }
    process.exit(1);
  }
);
