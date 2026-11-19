import "server-only";

import { db } from "@/lib/db";
import { sequences, sequenceSteps, leadSequences, leads, notes } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";

/**
 * Run the due sequence steps.
 *
 * With a user id, only that user's enrollments are processed. Without one
 * (the CRON_SECRET path), every user's are. In both cases an enrollment is
 * only processed when its lead and its sequence belong to the same user, so a
 * planted row can never write into another user's account.
 */
export async function processDueSequences(userId?: string) {
  const now = new Date().toISOString();
  const conditions = [
    eq(leadSequences.status, "active"),
    sql`${leadSequences.nextActionAt} <= ${now}`,
    eq(leads.userId, sequences.userId),
  ];
  if (userId) conditions.push(eq(sequences.userId, userId));

  const dueItems = await db
    .select({
      id: leadSequences.id,
      leadId: leadSequences.leadId,
      sequenceId: leadSequences.sequenceId,
      currentStep: leadSequences.currentStep,
      firstName: leads.firstName,
      lastName: leads.lastName,
      propertyAddress: leads.propertyAddress,
      phone: leads.phone,
    })
    .from(leadSequences)
    .innerJoin(sequences, eq(leadSequences.sequenceId, sequences.id))
    .innerJoin(leads, eq(leadSequences.leadId, leads.id))
    .where(and(...conditions));

  let processed = 0;

  for (const item of dueItems) {
    const steps = await db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, item.sequenceId))
      .orderBy(sequenceSteps.stepOrder);

    const currentStep = steps[item.currentStep];
    if (!currentStep) {
      await db.update(leadSequences)
        .set({ status: "completed" })
        .where(eq(leadSequences.id, item.id));
      continue;
    }

    let content = currentStep.template || `Follow-up: ${currentStep.actionType}`;
    content = content
      .replace(/\{\{first_name\}\}/g, item.firstName || "")
      .replace(/\{\{last_name\}\}/g, item.lastName || "")
      .replace(/\{\{property_address\}\}/g, item.propertyAddress || "")
      .replace(/\{\{phone\}\}/g, item.phone || "");

    await db.insert(notes)
      .values({
        leadId: item.leadId,
        content: `[SEQUENCE TASK - ${currentStep.actionType.toUpperCase()}] ${content}`,
      });

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
