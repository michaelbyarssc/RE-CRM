"use server";

import { db } from "@/lib/db";
import { notes, leads } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function getNotes(leadId: number) {
  const authUser = await getAuthenticatedUser();

  // Verify lead belongs to user
  const [lead] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.userId, authUser.effectiveId))).limit(1);
  if (!lead) return [];

  return await db
    .select()
    .from(notes)
    .where(eq(notes.leadId, leadId))
    .orderBy(sql`${notes.createdAt} DESC`);
}

export async function createNote(leadId: number, content: string) {
  const authUser = await getAuthenticatedUser();

  // Verify lead belongs to user
  const [lead] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.userId, authUser.effectiveId))).limit(1);
  if (!lead) throw new Error("Lead not found");

  const [note] = await db.insert(notes).values({ leadId, content }).returning();
  return note;
}

export async function deleteNote(id: number) {
  const authUser = await getAuthenticatedUser();

  // Verify note's lead belongs to user
  const [note] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  if (!note) return;

  const [lead] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.id, note.leadId), eq(leads.userId, authUser.effectiveId))).limit(1);
  if (!lead) return;

  await db.delete(notes).where(eq(notes.id, id));
}
