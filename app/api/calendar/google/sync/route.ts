import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarEvents, googleCalendarTokens } from "@/lib/db/schema";
import { eq, isNull, and, or } from "drizzle-orm";
import {
  getValidToken,
  pushEventToGoogle,
  pullEventsFromGoogle,
} from "@/lib/google-calendar";
import { withAuth } from "@/lib/api-handler";

// POST: Trigger a two-way sync for the current user
export const POST = withAuth(async ({ user: authUser }) => {
  const userId = authUser.effectiveId;

  const token = await getValidToken(userId);
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

  // 1. PUSH: Send unsynced CRM events to Google (scoped to user)
  const unsyncedEvents = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        or(
          isNull(calendarEvents.googleEventId),
          eq(calendarEvents.syncStatus, "pending")
        )
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
      const [existing] = await db
        .select()
        .from(calendarEvents)
        .where(and(
          eq(calendarEvents.googleEventId, gEvent.id),
          eq(calendarEvents.userId, userId)
        ));

      if (existing) {
        const googleUpdated = new Date(gEvent.updated).getTime();
        const crmUpdated = new Date(existing.updatedAt).getTime();

        if (googleUpdated > crmUpdated) {
          const startAt = gEvent.start?.dateTime || gEvent.start?.date;
          const endAt = gEvent.end?.dateTime || gEvent.end?.date;
          const allDay = !gEvent.start?.dateTime;
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
            .where(and(eq(calendarEvents.id, existing.id), eq(calendarEvents.userId, userId)));
          pulled++;
        }
      } else {
        if (gEvent.status === "cancelled") continue;

        const startAt = gEvent.start?.dateTime || gEvent.start?.date;
        const endAt = gEvent.end?.dateTime || gEvent.end?.date;
        const allDay = !gEvent.start?.dateTime;

        if (!startAt) continue;
        const toLocal = (dt: string) => dt.slice(0, 19);

        await db.insert(calendarEvents).values({
          userId,
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
    console.error(`Pull from Google failed: user ${userId}, ${err instanceof Error ? err.name : "unknown error"}.`);
    errors++;
  }

  // Update last sync time
  const nowISO = new Date().toISOString();
  await db
    .update(googleCalendarTokens)
    .set({
      lastSyncAt: nowISO,
      updatedAt: nowISO,
    })
    .where(and(eq(googleCalendarTokens.id, tokenRow.id), eq(googleCalendarTokens.userId, userId)));

  return NextResponse.json({ pushed, pulled, errors });
});
