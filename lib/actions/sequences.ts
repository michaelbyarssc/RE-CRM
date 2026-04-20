"use server";

import { db } from "@/lib/db";
import { sequences, sequenceSteps, leadSequences, leads, notes } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";

export async function getSequences() {
  const seqs = await db.select().from(sequences).orderBy(sql`${sequences.createdAt} DESC`);

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
  const [seq] = await db.select().from(sequences).where(eq(sequences.id, id)).limit(1);
  if (!seq) return null;

  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, id))
    .orderBy(sequenceSteps.stepOrder);

  return { ...seq, steps };
}

export async function createSequence(name: string, description: string) {
  const [seq] = await db.insert(sequences).values({ name, description }).returning();
  return seq;
}

export async function updateSequence(id: number, data: { name?: string; description?: string; isActive?: number }) {
  await db.update(sequences).set(data).where(eq(sequences.id, id));
}

export async function deleteSequence(id: number) {
  await db.delete(sequences).where(eq(sequences.id, id));
}

export async function addStep(sequenceId: number, step: {
  stepOrder: number;
  delayDays: number;
  actionType: string;
  template: string;
}) {
  const [newStep] = await db.insert(sequenceSteps).values({ sequenceId, ...step }).returning();
  return newStep;
}

export async function updateStep(id: number, data: Partial<typeof sequenceSteps.$inferInsert>) {
  await db.update(sequenceSteps).set(data).where(eq(sequenceSteps.id, id));
}

export async function deleteStep(id: number) {
  await db.delete(sequenceSteps).where(eq(sequenceSteps.id, id));
}

export async function enrollLeads(leadIds: number[], sequenceId: number) {
  const [seq] = await db.select().from(sequences).where(eq(sequences.id, sequenceId)).limit(1);
  if (!seq) return;

  const [firstStep] = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, sequenceId))
    .orderBy(sequenceSteps.stepOrder)
    .limit(1);

  for (const leadId of leadIds) {
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

export async function processSequences() {
  const now = new Date().toISOString();
  const dueItems = await db
    .select()
    .from(leadSequences)
    .where(and(eq(leadSequences.status, "active"), sql`${leadSequences.nextActionAt} <= ${now}`));

  let processed = 0;

  for (const item of dueItems) {
    const steps = await db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, item.sequenceId))
      .orderBy(sequenceSteps.stepOrder);

    const currentStep = steps[item.currentStep];
    if (!currentStep) {
      // All steps completed
      await db.update(leadSequences)
        .set({ status: "completed" })
        .where(eq(leadSequences.id, item.id));
      continue;
    }

    // Get lead info for template
    const [lead] = await db.select().from(leads).where(eq(leads.id, item.leadId)).limit(1);
    if (!lead) continue;

    // Replace template placeholders
    let content = currentStep.template || `Follow-up: ${currentStep.actionType}`;
    content = content
      .replace(/\{\{first_name\}\}/g, lead.firstName || "")
      .replace(/\{\{last_name\}\}/g, lead.lastName || "")
      .replace(/\{\{property_address\}\}/g, lead.propertyAddress || "")
      .replace(/\{\{phone\}\}/g, lead.phone || "");

    // Create a task note
    await db.insert(notes)
      .values({
        leadId: item.leadId,
        content: `[SEQUENCE TASK - ${currentStep.actionType.toUpperCase()}] ${content}`,
      });

    // Advance to next step
    const nextStepIndex = item.currentStep + 1;
    const nextStep = steps[nextStepIndex];

    if (nextStep) {
      const nextActionAt = new Date(Date.now() + nextStep.delayDays * 86400000).toISOString();
      await db.update(leadSequences)
        .set({ currentStep: nextStepIndex, nextActionAt })
        .where(eq(leadSequences.id, item.id));
    } else {
      await db.update(leadSequences)
        .set({ status: "completed" })
        .where(eq(leadSequences.id, item.id));
    }

    processed++;
  }

  return { processed };
}
