import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarEvents, googleCalendarTokens } from "@/lib/db/schema";
import { eq, isNull, isNotNull, and, or } from "drizzle-orm";
import {
  getValidToken,
  pushEventToGoogle,
  pullEventsFromGoogle,
  deleteEventFromGoogle,
} from "@/lib/google-calendar";

// POST: Trigger a two-way sync
export async function POST(req: NextRequest) {
  const token = await getValidToken();
  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 400 }
    );
  }

  const { accessToken, tokenRow } = token;
  const calendarId = tokenRow.calendarId || "primary";
  let pushed = 0;
  let pulled = 0;
  let errors = 0;

  // 1. PUSH: Send unsynced CRM events to Google
  const unsyncedEvents = await db
    .select()
    .from(calendarEvents)
    .where(
      or(
        isNull(calendarEvents.googleEventId),
        eq(calendarEvents.syncStatus, "pending")
      )
    );

  for (const event of unsyncedEvents) {
    try {
      const result = await pushEventToGoogle(accessToken, calendarId, event);
      if (result) pushed++;
      else errors++;
    } catch {
      errors++;
    }
  }

  // 2. PULL: Get updated events from Google
  try {
    const googleEvents = await pullEventsFromGoogle(
      accessToken,
      calendarId,
      tokenRow.lastSyncAt
    );

    for (const gEvent of googleEvents) {
      // Check if we already have this event
      const [existing] = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.googleEventId, gEvent.id));

      if (existing) {
        // Update existing CRM event from Google
        const googleUpdated = new Date(gEvent.updated).getTime();
        const crmUpdated = new Date(existing.updatedAt).getTime();

        // Only update if Google version is newer
        if (googleUpdated > crmUpdated) {
          const startAt = gEvent.start?.dateTime || gEvent.start?.date;
          const endAt = gEvent.end?.dateTime || gEvent.end?.date;
          const allDay = !gEvent.start?.dateTime;

          // Extract local time from Google's datetime (strip timezone offset)
          // "2026-04-20T18:00:00-04:00" → "2026-04-20T18:00:00"
          const toLocal = (dt: string) => dt.slice(0, 19);

          await db
            .update(calendarEvents)
            .set({
              title: gEvent.summary || existing.title,
              description: gEvent.description || null,
              location: gEvent.location || null,
              startAt: startAt ? toLocal(startAt) : existing.startAt,
              endAt: endAt ? toLocal(endAt) : null,
              allDay: allDay ? 1 : 0,
              status: gEvent.status === "cancelled" ? "cancelled" : existing.status,
              syncStatus: "synced",
              updatedAt: new Date().toLocaleString("sv-SE").replace(" ", "T"),
            })
            .where(eq(calendarEvents.id, existing.id));
          pulled++;
        }
      } else {
        // Create new CRM event from Google
        if (gEvent.status === "cancelled") continue;

        const startAt = gEvent.start?.dateTime || gEvent.start?.date;
        const endAt = gEvent.end?.dateTime || gEvent.end?.date;
        const allDay = !gEvent.start?.dateTime;

        if (!startAt) continue;

        // Extract local time from Google's datetime (strip timezone offset)
        const toLocal = (dt: string) => dt.slice(0, 19);

        await db.insert(calendarEvents).values({
          title: gEvent.summary || "Untitled",
          description: gEvent.description || null,
          eventType: "custom",
          startAt: toLocal(startAt),
          endAt: endAt ? toLocal(endAt) : null,
          allDay: allDay ? 1 : 0,
          location: gEvent.location || null,
          status: "scheduled",
          googleEventId: gEvent.id,
          googleCalendarId: calendarId,
          syncStatus: "synced",
        });
        pulled++;
      }
    }
  } catch (err) {
    console.error("Pull from Google failed:", err);
    errors++;
  }

  // Update last sync time (keep as ISO for Google API compatibility)
  const nowISO = new Date().toISOString();
  await db
    .update(googleCalendarTokens)
    .set({
      lastSyncAt: nowISO,
      updatedAt: nowISO,
    })
    .where(eq(googleCalendarTokens.id, tokenRow.id));

  return NextResponse.json({ pushed, pulled, errors });
}
