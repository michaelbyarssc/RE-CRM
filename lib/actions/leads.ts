"use server";

import { db } from "@/lib/db";
import { leads, tags, leadTags, csvImports } from "@/lib/db/schema";
import { eq, like, or, inArray, sql, and } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export type Lead = typeof leads.$inferSelect;
export type Tag = typeof tags.$inferSelect;

export async function getLeads(params?: {
  search?: string;
  status?: string;
  tagId?: number;
  page?: number;
  pageSize?: number;
}) {
  const authUser = await getAuthenticatedUser();
  const userId = authUser.effectiveId;

  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  let conditions = [eq(leads.userId, userId)];

  if (params?.search) {
    const term = `%${params.search}%`;
    conditions.push(
      or(
        like(leads.firstName, term),
        like(leads.lastName, term),
        like(leads.propertyAddress, term),
        like(leads.propertyCity, term),
        like(leads.phone, term),
        like(leads.email, term)
      )!
    );
  }

  if (params?.status && params.status !== "all") {
    conditions.push(eq(leads.status, params.status));
  }

  const whereClause = and(...conditions);

  const rows = await db
    .select()
    .from(leads)
    .where(whereClause)
    .orderBy(sql`${leads.createdAt} DESC`)
    .limit(pageSize)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(whereClause);

  const total = countResult[0]?.count ?? 0;

  // Get tags for each lead
  const leadsWithTags = [];
  for (const lead of rows) {
    const leadTagRows = await db
      .select({ tag: tags })
      .from(leadTags)
      .innerJoin(tags, eq(leadTags.tagId, tags.id))
      .where(eq(leadTags.leadId, lead.id));

    leadsWithTags.push({
      ...lead,
      tags: leadTagRows.map((r) => r.tag),
    });
  }

  return { leads: leadsWithTags, total, page, pageSize };
}

export async function getLead(id: number) {
  const authUser = await getAuthenticatedUser();
  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.id, id), eq(leads.userId, authUser.effectiveId)))
    .limit(1);
  if (!lead) return null;

  const leadTagRows = await db
    .select({ tag: tags })
    .from(leadTags)
    .innerJoin(tags, eq(leadTags.tagId, tags.id))
    .where(eq(leadTags.leadId, id));

  return { ...lead, tags: leadTagRows.map((r) => r.tag) };
}

export async function updateLeadStatus(id: number, status: string) {
  const authUser = await getAuthenticatedUser();
  await db.update(leads)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(and(eq(leads.id, id), eq(leads.userId, authUser.effectiveId)));
}

export async function updateLead(id: number, data: Partial<typeof leads.$inferInsert>) {
  const authUser = await getAuthenticatedUser();
  await db.update(leads)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(and(eq(leads.id, id), eq(leads.userId, authUser.effectiveId)));
}

export async function bulkUpdateStatus(ids: number[], status: string) {
  const authUser = await getAuthenticatedUser();
  await db.update(leads)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(and(inArray(leads.id, ids), eq(leads.userId, authUser.effectiveId)));
}

export async function bulkAddTag(leadIds: number[], tagId: number) {
  const authUser = await getAuthenticatedUser();
  // Verify leads belong to user
  const userLeads = await db.select({ id: leads.id }).from(leads)
    .where(and(inArray(leads.id, leadIds), eq(leads.userId, authUser.effectiveId)));
  const validIds = userLeads.map((l) => l.id);

  for (const leadId of validIds) {
    try {
      await db.insert(leadTags).values({ leadId, tagId });
    } catch {
      // ignore duplicates
    }
  }
}

export async function bulkDeleteLeads(ids: number[]) {
  const authUser = await getAuthenticatedUser();
  await db.delete(leads).where(and(inArray(leads.id, ids), eq(leads.userId, authUser.effectiveId)));
}

export async function removeTagFromLead(leadId: number, tagId: number) {
  const authUser = await getAuthenticatedUser();
  // Verify lead belongs to user
  const [lead] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.userId, authUser.effectiveId))).limit(1);
  if (!lead) return;

  await db.delete(leadTags)
    .where(and(eq(leadTags.leadId, leadId), eq(leadTags.tagId, tagId)));
}

export async function addTagToLead(leadId: number, tagId: number) {
  const authUser = await getAuthenticatedUser();
  const [lead] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.userId, authUser.effectiveId))).limit(1);
  if (!lead) return;

  try {
    await db.insert(leadTags).values({ leadId, tagId });
  } catch {
    // ignore duplicate
  }
}

export async function getAllTags() {
  const authUser = await getAuthenticatedUser();
  return await db.select().from(tags).where(eq(tags.userId, authUser.effectiveId));
}

export async function createTag(name: string, color: string) {
  const authUser = await getAuthenticatedUser();
  const [tag] = await db.insert(tags).values({ name, color, userId: authUser.effectiveId }).returning();
  return tag;
}

export async function importLeads(
  data: Record<string, string>[],
  columnMapping: Record<string, string>,
  filename: string
) {
  const authUser = await getAuthenticatedUser();
  const userId = authUser.effectiveId;
  let imported = 0;
  let skipped = 0;

  for (const row of data) {
    const mapped: Record<string, string> = {};
    const extra: Record<string, string> = {};

    for (const [csvCol, value] of Object.entries(row)) {
      const field = columnMapping[csvCol];
      if (field && field !== "skip") {
        mapped[field] = value?.trim() || "";
      } else if (field !== "skip") {
        extra[csvCol] = value?.trim() || "";
      }
    }

    if (!mapped.propertyAddress) {
      skipped++;
      continue;
    }

    // Check for duplicate by property address (scoped to user)
    const normalized = mapped.propertyAddress.toLowerCase().replace(/\s+/g, " ").trim();
    const [existing] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(
        eq(leads.userId, userId),
        sql`lower(replace(${leads.propertyAddress}, '  ', ' ')) = ${normalized}`
      ))
      .limit(1);

    if (existing) {
      skipped++;
      continue;
    }

    await db.insert(leads)
      .values({
        userId,
        firstName: mapped.firstName || null,
        lastName: mapped.lastName || null,
        propertyAddress: mapped.propertyAddress,
        propertyCity: mapped.propertyCity || null,
        propertyState: mapped.propertyState || null,
        propertyZip: mapped.propertyZip || null,
        mailingAddress: mapped.mailingAddress || null,
        mailingCity: mapped.mailingCity || null,
        mailingState: mapped.mailingState || null,
        mailingZip: mapped.mailingZip || null,
        phone: mapped.phone || null,
        email: mapped.email || null,
        source: filename,
        customData: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
      });

    imported++;
  }

  // Record import
  await db.insert(csvImports)
    .values({
      userId,
      filename,
      totalRows: data.length,
      importedRows: imported,
      skippedRows: skipped,
      columnMapping: JSON.stringify(columnMapping),
    });

  return { imported, skipped, total: data.length };
}

export async function getLeadCounts() {
  const authUser = await getAuthenticatedUser();
  const results = await db
    .select({
      status: leads.status,
      count: sql<number>`count(*)`,
    })
    .from(leads)
    .where(eq(leads.userId, authUser.effectiveId))
    .groupBy(leads.status);

  const total = results.reduce((sum, r) => sum + r.count, 0);
  return { byStatus: results, total };
}
