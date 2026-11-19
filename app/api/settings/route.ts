import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { withAuth, readJson } from "@/lib/api-handler";
import { parseWith } from "@/lib/validation";

// A flat object of setting names to values. Values that are not strings are
// skipped, as before. Names starting with "_" are reserved for the server
// (for example the Google connect marker): never returned, never accepted.
const settingsSchema = z.record(
  z.string().min(1).max(100).refine((k) => !k.startsWith("_")),
  z.unknown()
);
const MAX_VALUE_LENGTH = 10_000;

export const GET = withAuth(async ({ user: authUser }) => {
  const allSettings = await db.select().from(settings)
    .where(eq(settings.userId, authUser.effectiveId));
  const map: Record<string, string> = {};
  for (const s of allSettings) {
    if (s.key.startsWith("_")) continue;
    map[s.key] = s.value;
  }
  return NextResponse.json(map);
});

export const POST = withAuth(async ({ req, user: authUser }) => {
  const body = parseWith(settingsSchema, await readJson(req));

  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) continue;

    const existing = await db
      .select()
      .from(settings)
      .where(and(eq(settings.key, key), eq(settings.userId, authUser.effectiveId)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({ value, updatedAt: new Date().toISOString() })
        .where(and(eq(settings.key, key), eq(settings.userId, authUser.effectiveId)));
    } else {
      await db.insert(settings).values({ key, value, userId: authUser.effectiveId });
    }
  }

  return NextResponse.json({ ok: true });
});
