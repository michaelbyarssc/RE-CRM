import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET() {
  const authUser = await getAuthenticatedUser();
  const allSettings = await db.select().from(settings)
    .where(eq(settings.userId, authUser.effectiveId));
  const map: Record<string, string> = {};
  for (const s of allSettings) {
    map[s.key] = s.value;
  }
  return NextResponse.json(map);
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  const body: Record<string, string> = await req.json();

  for (const [key, value] of Object.entries(body)) {
    if (typeof key !== "string" || typeof value !== "string") continue;

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
}
