import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { callLog } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get("leadId");

  if (leadId) {
    const calls = await db
      .select()
      .from(callLog)
      .where(eq(callLog.leadId, Number(leadId)))
      .orderBy(sql`${callLog.calledAt} DESC`);
    return NextResponse.json(calls);
  }

  const calls = await db
    .select()
    .from(callLog)
    .orderBy(sql`${callLog.calledAt} DESC`)
    .limit(50);
  return NextResponse.json(calls);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const [call] = await db
    .insert(callLog)
    .values({
      leadId: body.leadId,
      direction: body.direction || "outbound",
      duration: body.duration || 0,
      disposition: body.disposition,
      notes: body.notes,
    })
    .returning();
  return NextResponse.json(call);
}
