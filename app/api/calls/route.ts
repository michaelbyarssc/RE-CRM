import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { callLog, leads } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get("leadId");

  if (leadId) {
    // Verify lead belongs to user
    const [lead] = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.id, Number(leadId)), eq(leads.userId, authUser.effectiveId))).limit(1);
    if (!lead) return NextResponse.json([]);

    const calls = await db
      .select()
      .from(callLog)
      .where(eq(callLog.leadId, Number(leadId)))
      .orderBy(sql`${callLog.calledAt} DESC`);
    return NextResponse.json(calls);
  }

  // List recent calls — join to leads to filter by user
  const calls = await db
    .select({
      id: callLog.id,
      leadId: callLog.leadId,
      direction: callLog.direction,
      duration: callLog.duration,
      disposition: callLog.disposition,
      notes: callLog.notes,
      calledAt: callLog.calledAt,
    })
    .from(callLog)
    .innerJoin(leads, eq(callLog.leadId, leads.id))
    .where(eq(leads.userId, authUser.effectiveId))
    .orderBy(sql`${callLog.calledAt} DESC`)
    .limit(50);
  return NextResponse.json(calls);
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  const body = await req.json();

  // Verify lead belongs to user
  const [lead] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.id, body.leadId), eq(leads.userId, authUser.effectiveId))).limit(1);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

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
