import { NextRequest, NextResponse } from "next/server";
import { getNotes, createNote, deleteNote } from "@/lib/actions/notes";
import { createEvent } from "@/lib/actions/calendar";
import { parseNoteForEvent } from "@/lib/parse-note-events";
import { autoSyncEvent } from "@/lib/google-calendar";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leadId = Number(searchParams.get("leadId"));
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  const notes = await getNotes(leadId);
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  const body = await req.json();
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
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteNote(id);
  return NextResponse.json({ ok: true });
}
