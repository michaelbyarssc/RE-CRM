import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";
import { sequences, sequenceSteps, leadSequences, leads } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { parseWith } from "@/lib/validation";

const intField = (min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && /^-?\d{1,6}$/.test(v) ? Number(v) : v),
    z.number().int().min(min).max(max)
  );

// The only step fields a client may send. sequenceId and id always come from
// the checked values, never from the body.
const stepSchema = z.object({
  stepOrder: intField(0, 10000),
  delayDays: intField(0, 3650),
  actionType: z.string().trim().min(1).max(50),
  template: z.string().max(5000).nullable().optional(),
});

const sequenceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z
    .union([z.boolean(), z.literal(0), z.literal(1)])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? 1 : 0)),
});

function definedOnly<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function ownSequenceId(sequenceId: number, userId: string) {
  const [seq] = await db.select({ id: sequences.id }).from(sequences)
    .where(and(eq(sequences.id, sequenceId), eq(sequences.userId, userId))).limit(1);
  return seq?.id ?? null;
}

/** The step, if it belongs to one of the user's sequences (and to `sequenceId` when given). */
async function ownStep(stepId: number, userId: string, sequenceId?: number) {
  const [row] = await db
    .select({ id: sequenceSteps.id, sequenceId: sequenceSteps.sequenceId })
    .from(sequenceSteps)
    .innerJoin(sequences, eq(sequenceSteps.sequenceId, sequences.id))
    .where(and(eq(sequenceSteps.id, stepId), eq(sequences.userId, userId)))
    .limit(1);
  if (!row) return null;
  if (sequenceId !== undefined && row.sequenceId !== sequenceId) return null;
  return row;
}

export async function getSequences() {
  const authUser = await getAuthenticatedUser();

  const seqs = await db.select().from(sequences)
    .where(eq(sequences.userId, authUser.effectiveId))
    .orderBy(sql`${sequences.createdAt} DESC`);

  const result = [];
  for (const seq of seqs) {
    const steps = await db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, seq.id))
      .orderBy(sequenceSteps.stepOrder);

    const [enrolledCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(leadSequences)
      .where(and(eq(leadSequences.sequenceId, seq.id), eq(leadSequences.status, "active")));

    result.push({ ...seq, steps, enrolledCount: enrolledCount?.count ?? 0 });
  }

  return result;
}

export async function getSequence(id: number) {
  const authUser = await getAuthenticatedUser();

  const [seq] = await db.select().from(sequences)
    .where(and(eq(sequences.id, id), eq(sequences.userId, authUser.effectiveId)))
    .limit(1);
  if (!seq) return null;

  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, id))
    .orderBy(sequenceSteps.stepOrder);

  return { ...seq, steps };
}

export async function createSequence(name: string, description: string) {
  const authUser = await getAuthenticatedUser();
  const [seq] = await db.insert(sequences).values({ name, description, userId: authUser.effectiveId }).returning();
  return seq;
}

/** Update name, description or isActive. `data` is untrusted; other fields are dropped. */
export async function updateSequence(id: number, data: unknown) {
  const authUser = await getAuthenticatedUser();
  const fields = definedOnly(parseWith(sequenceUpdateSchema, data));
  if (Object.keys(fields).length === 0) {
    if (!(await ownSequenceId(id, authUser.effectiveId))) throw new NotFoundError("Sequence not found");
    return;
  }
  const updated = await db.update(sequences).set(fields)
    .where(and(eq(sequences.id, id), eq(sequences.userId, authUser.effectiveId)))
    .returning({ id: sequences.id });
  if (updated.length === 0) throw new NotFoundError("Sequence not found");
}

export async function deleteSequence(id: number) {
  const authUser = await getAuthenticatedUser();
  await db.delete(sequences)
    .where(and(eq(sequences.id, id), eq(sequences.userId, authUser.effectiveId)));
}

/** Add a step to one of the caller's sequences. `step` is untrusted. */
export async function addStep(sequenceId: number, step: unknown) {
  const authUser = await getAuthenticatedUser();
  const fields = parseWith(stepSchema, step);
  if (!(await ownSequenceId(sequenceId, authUser.effectiveId))) throw new NotFoundError("Sequence not found");

  // sequenceId is set last, from the verified value.
  const [newStep] = await db.insert(sequenceSteps).values({ ...fields, sequenceId }).returning();
  return newStep;
}

/** Update a step's allowed fields. The step must be in `sequenceId`, owned by the caller. */
export async function updateStep(id: number, data: unknown, sequenceId?: number) {
  const authUser = await getAuthenticatedUser();
  const fields = definedOnly(parseWith(stepSchema.partial(), data));
  const step = await ownStep(id, authUser.effectiveId, sequenceId);
  if (!step) throw new NotFoundError("Step not found");
  if (Object.keys(fields).length === 0) return;

  await db.update(sequenceSteps).set(fields)
    .where(and(eq(sequenceSteps.id, id), eq(sequenceSteps.sequenceId, step.sequenceId)));
}

export async function deleteStep(id: number, sequenceId?: number) {
  const authUser = await getAuthenticatedUser();
  const step = await ownStep(id, authUser.effectiveId, sequenceId);
  if (!step) return;

  await db.delete(sequenceSteps)
    .where(and(eq(sequenceSteps.id, id), eq(sequenceSteps.sequenceId, step.sequenceId)));
}

export async function enrollLeads(leadIds: number[], sequenceId: number) {
  const authUser = await getAuthenticatedUser();

  // Verify sequence belongs to user
  const [seq] = await db.select().from(sequences)
    .where(and(eq(sequences.id, sequenceId), eq(sequences.userId, authUser.effectiveId))).limit(1);
  if (!seq) throw new NotFoundError("Sequence not found");

  const [firstStep] = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, sequenceId))
    .orderBy(sequenceSteps.stepOrder)
    .limit(1);

  for (const leadId of leadIds) {
    // Verify lead belongs to user
    const [lead] = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, authUser.effectiveId))).limit(1);
    if (!lead) continue;

    // Check if already enrolled
    const [existing] = await db
      .select()
      .from(leadSequences)
      .where(and(eq(leadSequences.leadId, leadId), eq(leadSequences.sequenceId, sequenceId), eq(leadSequences.status, "active")))
      .limit(1);

    if (existing) continue;

    const nextActionAt = firstStep
      ? new Date(Date.now() + firstStep.delayDays * 86400000).toISOString()
      : null;

    await db.insert(leadSequences)
      .values({ leadId, sequenceId, currentStep: 0, status: "active", nextActionAt });
  }
}
