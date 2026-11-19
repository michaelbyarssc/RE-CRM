import { NextResponse } from "next/server";
import { z } from "zod";
import { getNotes, createNote, deleteNote } from "@/lib/actions/notes";
import { createEvent } from "@/lib/actions/calendar";
import { parseNoteForEvent } from "@/lib/parse-note-events";
import { autoSyncEvent } from "@/lib/google-calendar";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { withAuth, readJson } from "@/lib/api-handler";
import { idSchema, parseId, parseWith } from "@/lib/validation";

const MAX_NOTE_LENGTH = 10_000;

const noteSchema = z.object({
  leadId: idSchema,
  content: z.string().min(1).max(MAX_NOTE_LENGTH),
  // The browser's local time, "YYYY-MM-DDTHH:mm:ss". Anything else is ignored.
  localNow: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/)
    .optional()
    .catch(undefined),
});

export const GET = withAuth(async ({ req }) => {
  const leadId = parseId(req.nextUrl.searchParams.get("leadId"));
  const notes = await getNotes(leadId);
  return NextResponse.json(notes);
});

export const POST = withAuth(async ({ req, user: authUser }) => {
  const body = parseWith(noteSchema, await readJson(req));
  // 404 when the lead is not the caller's.
  const note = await createNote(body.leadId, body.content);

  // Try to auto-create a calendar event from the note
  let calendarEvent = null;
  try {
    const [lead] = await db
      .select({ firstName: leads.firstName, lastName: leads.lastName, propertyAddress: leads.propertyAddress })
      .from(leads)
      .where(and(eq(leads.id, body.leadId), eq(leads.userId, authUser.effectiveId)));

    if (lead) {
      const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Lead";
      const parsed = parseNoteForEvent(body.content, leadName, body.localNow);

      if (parsed) {
        calendarEvent = await createEvent({
          title: parsed.title,
          description: `Auto-created from note: "${body.content}"`,
          eventType: parsed.eventType,
          startAt: parsed.startAt,
          location: parsed.location,
          leadId: body.leadId,
        });

        // Immediately push to Google Calendar (event has userId from createEvent)
        if (calendarEvent) autoSyncEvent(calendarEvent);
      }
    }
  } catch (err) {
    console.error("Auto-calendar from note failed:", err);
  }

  return NextResponse.json({
    ...note,
    calendarEvent: calendarEvent
      ? { id: calendarEvent.id, title: calendarEvent.title, startAt: calendarEvent.startAt, eventType: calendarEvent.eventType }
      : null,
  });
});

export const DELETE = withAuth(async ({ req }) => {
  const id = parseId(req.nextUrl.searchParams.get("id"));
  await deleteNote(id);
  return NextResponse.json({ ok: true });
});
