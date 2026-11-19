import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { withAuth, readJson } from "@/lib/api-handler";
import { parseWith } from "@/lib/validation";
import { BadRequestError } from "@/lib/errors";
import {
  encryptSettingValue,
  isReservedSetting,
  isSecretSetting,
  lastFour,
  readSettingValue,
  requireKeyRing,
} from "@/lib/secrets";

// Saved settings for the signed-in user (or the user an admin is acting as).
//
// Every key except the public ones in lib/secrets/policy.mjs is a secret:
// it is saved encrypted and never sent back. GET says only whether it is set
// and its last 4 characters. In POST an empty value keeps what is saved;
// DELETE is the way to clear. Without the encryption key, a POST that would
// save a secret answers 503 and saves nothing at all.
//
// Names starting with "_" are reserved for the server (for example the
// Google connect marker "_google_oauth_pending"): never returned by GET, and
// any request that names one is refused with 400 by POST and DELETE.

// A flat object of setting names to values. Values that are not strings are
// skipped, as before. A name is letters, digits, "_", "." or "-", 1 to 100
// characters, not starting with "_" (names starting with "_" are reserved for
// the server, see isReservedSetting), and one request carries at most 50
// names, so one request cannot store unlimited rows. The check runs on the
// raw parsed object, so it also sees a key named "__proto__" (which a zod
// record would drop) and refuses it as reserved.
const SETTING_NAME = /^[A-Za-z0-9.-][A-Za-z0-9_.-]{0,99}$/;
const MAX_KEYS_PER_REQUEST = 50;
function isAcceptedName(name: string): boolean {
  return SETTING_NAME.test(name) && !isReservedSetting(name);
}
const settingsSchema = z.custom<Record<string, unknown>>(
  (v) =>
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length <= MAX_KEYS_PER_REQUEST &&
    Object.keys(v).every(isAcceptedName)
);
const MAX_VALUE_LENGTH = 10_000;
const MAX_DELETE_KEYS = 50;

type SecretStatus = { set: boolean; last4: string | null; unreadable?: true };

export const GET = withAuth(async ({ user: authUser }) => {
  const userId = authUser.effectiveId;
  const rows = await db.select().from(settings).where(eq(settings.userId, userId));
  // No prototype, so a setting named "__proto__" or "constructor" is an ordinary key.
  const values: Record<string, string> = Object.create(null);
  const secrets: Record<string, SecretStatus> = Object.create(null);
  for (const row of rows) {
    if (isReservedSetting(row.key)) continue; // server-only, never returned
    if (!isSecretSetting(row.key)) {
      values[row.key] = row.value;
      continue;
    }
    const read = readSettingValue(userId, row.key, row.value);
    if (read.state === "blank") {
      secrets[row.key] = { set: false, last4: null };
    } else if (read.state === "locked") {
      // Encrypted, but this server has no key (logged once). The value may be
      // fine, so it is only reported as saved, never as unreadable.
      secrets[row.key] = { set: true, last4: null };
    } else if (read.state === "unreadable") {
      // The key is configured and the value does not decrypt. The name is
      // user text: JSON.stringify keeps it on one line.
      console.error(`Saved setting could not be read: user ${userId}, key ${JSON.stringify(row.key)}.`);
      secrets[row.key] = { set: true, last4: null, unreadable: true };
    } else {
      secrets[row.key] = { set: true, last4: lastFour(read.value) };
    }
  }
  return NextResponse.json({ values, secrets });
});

export const POST = withAuth(async ({ req, user: authUser }) => {
  const userId = authUser.effectiveId;
  // The schema checks the raw parsed object and returns it unchanged, so the
  // entries below are exactly the names it accepted (reserved names, including
  // "__proto__", are already refused there).
  const body = parseWith(settingsSchema, await readJson(req));

  // Values that are not strings, and strings longer than 10,000 characters
  // (a secret measured after trimming), are skipped, as before; the other
  // names in the request are still saved. The settings page refuses an
  // over-long field itself, so it never says "saved" for a skipped value.
  const entries = Object.entries(body).filter(
    (e): e is [string, string] =>
      typeof e[1] === "string" &&
      (isSecretSetting(e[0]) ? e[1].trim().length : e[1].length) <= MAX_VALUE_LENGTH
  );

  // Work out every write first. Encrypting needs the key; if it is missing,
  // requireKeyRing() answers 503 before anything is written.
  const writes: { key: string; value: string }[] = [];
  for (const [key, value] of entries) {
    if (!isSecretSetting(key)) {
      writes.push({ key, value });
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) continue; // empty means "keep what is saved"
    writes.push({ key, value: encryptSettingValue(requireKeyRing(), userId, key, trimmed) });
  }

  // Select, then update or insert, as before: the live database may lack
  // the unique constraint that ON CONFLICT needs.
  await db.transaction(async (tx) => {
    for (const { key, value } of writes) {
      const existing = await tx
        .select({ id: settings.id })
        .from(settings)
        .where(and(eq(settings.key, key), eq(settings.userId, userId)))
        .limit(1);
      if (existing.length > 0) {
        await tx
          .update(settings)
          .set({ value, updatedAt: new Date().toISOString() })
          .where(and(eq(settings.key, key), eq(settings.userId, userId)));
      } else {
        await tx.insert(settings).values({ key, value, userId });
      }
    }
  });

  return NextResponse.json({ ok: true });
});

// DELETE /api/settings?key=<name>[&key=<name>...]: clear these settings.
export const DELETE = withAuth(async ({ req, user: authUser }) => {
  const keys = req.nextUrl.searchParams.getAll("key");
  // 1 to 50 names, each with the same name rule as POST (so server-only
  // names, which start with "_", cannot be cleared from the browser).
  if (keys.length === 0 || keys.length > MAX_DELETE_KEYS || !keys.every(isAcceptedName)) {
    throw new BadRequestError("Give 1 to 50 setting names as key=<name>");
  }
  await db
    .delete(settings)
    .where(and(eq(settings.userId, authUser.effectiveId), inArray(settings.key, keys)));
  return NextResponse.json({ ok: true });
});
