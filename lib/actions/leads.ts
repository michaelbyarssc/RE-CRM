import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import { leads, tags, leadTags, csvImports } from "@/lib/db/schema";
import { eq, like, or, inArray, sql, and } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";
import { LEAD_STATUSES } from "@/lib/constants";
import { BadRequestError, NotFoundError } from "@/lib/errors";
import { parseWith } from "@/lib/validation";

export type Lead = typeof leads.$inferSelect;
export type Tag = typeof tags.$inferSelect;

// The pipeline page asks for 500 at once.
export const MAX_PAGE_SIZE = 500;

const LEAD_STATUS_VALUES = LEAD_STATUSES.map((s) => s.value) as [string, ...string[]];
export const leadStatusSchema = z.enum(LEAD_STATUS_VALUES);

const text = (max: number) => z.string().max(max).nullable().optional();

// The lead fields a user may edit. Everything else in a request body
// (userId, id, createdAt, updatedAt, latitude, source, customData, ...) is dropped.
const leadUpdateSchema = z.object({
  firstName: text(200),
  lastName: text(200),
  propertyAddress: z.string().trim().min(1).max(500).optional(),
  propertyCity: text(200),
  propertyState: text(100),
  propertyZip: text(20),
  mailingAddress: text(500),
  mailingCity: text(200),
  mailingState: text(100),
  mailingZip: text(20),
  phone: text(50),
  email: text(320),
  status: leadStatusSchema.optional(),
});

async function tagsForLeads(leadIds: number[], userId: string) {
  const byLead = new Map<number, Tag[]>();
  if (leadIds.length === 0) return byLead;
  const rows = await db
    .select({ leadId: leadTags.leadId, tag: tags })
    .from(leadTags)
    .innerJoin(tags, and(eq(leadTags.tagId, tags.id), eq(tags.userId, userId)))
    .where(inArray(leadTags.leadId, leadIds));
  for (const r of rows) {
    const list = byLead.get(r.leadId) ?? [];
    list.push(r.tag);
    byLead.set(r.leadId, list);
  }
  return byLead;
}

async function assertOwnTag(tagId: number, userId: string) {
  const [tag] = await db.select({ id: tags.id }).from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.userId, userId))).limit(1);
  if (!tag) throw new NotFoundError("Tag not found");
}

export async function getLeads(params?: {
  search?: string;
  status?: string;
  tagId?: number;
  page?: number;
  pageSize?: number;
}) {
  const authUser = await getAuthenticatedUser();
  const userId = authUser.effectiveId;

  const page = Math.max(1, Math.floor(params?.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params?.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;

  const conditions = [eq(leads.userId, userId)];

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

  // Tags for the whole page in one query, only the caller's own tags.
  const tagMap = await tagsForLeads(rows.map((l) => l.id), userId);
  const leadsWithTags = rows.map((lead) => ({ ...lead, tags: tagMap.get(lead.id) ?? [] }));

  return { leads: leadsWithTags, total, page, pageSize };
}

export async function getLead(id: number) {
  const authUser = await getAuthenticatedUser();
  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.id, id), eq(leads.userId, authUser.effectiveId)))
    .limit(1);
  if (!lead) return null;

  const tagMap = await tagsForLeads([id], authUser.effectiveId);
  return { ...lead, tags: tagMap.get(id) ?? [] };
}

export async function updateLeadStatus(id: number, status: string) {
  const authUser = await getAuthenticatedUser();
  const valid = parseWith(leadStatusSchema, status);
  await db.update(leads)
    .set({ status: valid, updatedAt: new Date().toISOString() })
    .where(and(eq(leads.id, id), eq(leads.userId, authUser.effectiveId)));
}

/**
 * Update the editable fields of one of the caller's leads. `data` is
 * untrusted: it is checked against the allow-list and unknown fields are
 * dropped. Throws NotFoundError when the lead is not the caller's.
 */
export async function updateLead(id: number, data: unknown) {
  const authUser = await getAuthenticatedUser();
  const parsed = parseWith(leadUpdateSchema, data);
  const fields = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined));

  if (Object.keys(fields).length === 0) {
    const [lead] = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.id, id), eq(leads.userId, authUser.effectiveId))).limit(1);
    if (!lead) throw new NotFoundError("Lead not found");
    return;
  }

  const updated = await db.update(leads)
    .set({ ...fields, updatedAt: new Date().toISOString() })
    .where(and(eq(leads.id, id), eq(leads.userId, authUser.effectiveId)))
    .returning({ id: leads.id });
  if (updated.length === 0) throw new NotFoundError("Lead not found");
}

export async function bulkUpdateStatus(ids: number[], status: string) {
  const authUser = await getAuthenticatedUser();
  const valid = parseWith(leadStatusSchema, status);
  await db.update(leads)
    .set({ status: valid, updatedAt: new Date().toISOString() })
    .where(and(inArray(leads.id, ids), eq(leads.userId, authUser.effectiveId)));
}

export async function bulkAddTag(leadIds: number[], tagId: number) {
  const authUser = await getAuthenticatedUser();
  await assertOwnTag(tagId, authUser.effectiveId);
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
  if (!lead) throw new NotFoundError("Lead not found");
  await assertOwnTag(tagId, authUser.effectiveId);

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

// One import request carries at most this many rows (400 above it).
export const MAX_IMPORT_ROWS = 25_000;
const IMPORT_BATCH_SIZE = 500;

export async function importLeads(
  data: Record<string, string>[],
  columnMapping: Record<string, string>,
  filename: string
) {
  if (data.length > MAX_IMPORT_ROWS) {
    throw new BadRequestError(`At most ${MAX_IMPORT_ROWS} rows per import`);
  }
  const authUser = await getAuthenticatedUser();
  const userId = authUser.effectiveId;
  let skipped = 0;

  type NewLead = typeof leads.$inferInsert;
  const candidates: { values: NewLead; normalized: string }[] = [];

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

    candidates.push({
      normalized: mapped.propertyAddress.toLowerCase().replace(/\s+/g, " ").trim(),
      values: {
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
      },
    });
  }

  // Duplicate check for the whole file at once (it used to be one query per
  // row). The rule is unchanged: the incoming address, lower cased with white
  // space collapsed, is compared with lower(replace(property_address, '  ', ' '))
  // of the caller's stored leads, and a row that repeats an earlier inserted
  // row of the same file is skipped too. Postgres computes the stored form of
  // both the existing and the incoming addresses, so the comparison is the same
  // one the database made before.
  const taken = new Set<string>();
  if (candidates.length > 0) {
    const existing = await db
      .selectDistinct({ key: sql<string>`lower(replace(${leads.propertyAddress}, '  ', ' '))` })
      .from(leads)
      .where(eq(leads.userId, userId));
    for (const e of existing) taken.add(e.key);
  }
  const storedForms =
    candidates.length > 0
      ? await db.execute<{ key: string }>(sql`
          SELECT lower(replace(a, '  ', ' ')) AS key
          FROM jsonb_array_elements_text(${JSON.stringify(candidates.map((c) => c.values.propertyAddress))}::jsonb)
            WITH ORDINALITY AS t(a, i)
          ORDER BY i`)
      : [];

  const toInsert: NewLead[] = [];
  candidates.forEach((c, i) => {
    if (taken.has(c.normalized)) {
      skipped++;
      return;
    }
    toInsert.push(c.values);
    taken.add(storedForms[i].key);
  });

  for (let i = 0; i < toInsert.length; i += IMPORT_BATCH_SIZE) {
    await db.insert(leads).values(toInsert.slice(i, i + IMPORT_BATCH_SIZE));
  }
  const imported = toInsert.length;

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

  // Postgres returns count(*) as a bigint, which the driver hands back as a
  // string; convert it so the total is a sum and not "0" + "2" = "02".
  const byStatus = results.map((r) => ({ ...r, count: Number(r.count) }));
  const total = byStatus.reduce((sum, r) => sum + r.count, 0);
  return { byStatus, total };
}
