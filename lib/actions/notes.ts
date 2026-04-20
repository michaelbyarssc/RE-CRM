"use server";

import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function getNotes(leadId: number) {
  return await db
    .select()
    .from(notes)
    .where(eq(notes.leadId, leadId))
    .orderBy(sql`${notes.createdAt} DESC`);
}

export async function createNote(leadId: number, content: string) {
  const [note] = await db.insert(notes).values({ leadId, content }).returning();
  return note;
}

export async function deleteNote(id: number) {
  await db.delete(notes).where(eq(notes.id, id));
}
