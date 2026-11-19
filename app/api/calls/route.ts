import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { callLog, leads } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { withAuth, readJson } from "@/lib/api-handler";
import { idSchema, parseId, parseWith } from "@/lib/validation";

const callSchema = z.object({
  leadId: idSchema,
  direction: z.string().max(20).optional(),
  duration: z.number().int().min(0).max(86400).optional(),
  disposition: z.string().max(100).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
});

export const GET = withAuth(async ({ req, user: authUser }) => {
  const rawLeadId = req.nextUrl.searchParams.get("leadId");

  if (rawLeadId) {
    const leadId = parseId(rawLeadId);
    // Verify lead belongs to user
    const [lead] = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, authUser.effectiveId))).limit(1);
    if (!lead) return NextResponse.json([]);

    const calls = await db
      .select()
      .from(callLog)
      .where(eq(callLog.leadId, leadId))
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
});

export const POST = withAuth(async ({ req, user: authUser }) => {
  const body = parseWith(callSchema, await readJson(req));

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
});
