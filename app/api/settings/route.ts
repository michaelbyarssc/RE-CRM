import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const allSettings = await db.select().from(settings);
  const map: Record<string, string> = {};
  for (const s of allSettings) {
    map[s.key] = s.value;
  }
  return NextResponse.json(map);
}

export async function POST(req: NextRequest) {
  const body: Record<string, string> = await req.json();

  for (const [key, value] of Object.entries(body)) {
    if (typeof key !== "string" || typeof value !== "string") continue;

    const existing = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({ value, updatedAt: new Date().toISOString() })
        .where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }

  return NextResponse.json({ ok: true });
}
