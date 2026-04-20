import { db } from "@/lib/db";
import { googleCalendarTokens, calendarEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/google/callback`
  : "http://localhost:3001/api/calendar/google/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

export function getGoogleAuthUrl() {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error("Token refresh failed");
  }

  return res.json() as Promise<{
    access_token: string;
    expires_in: number;
  }>;
}

export async function getValidToken(): Promise<{ accessToken: string; tokenRow: typeof googleCalendarTokens.$inferSelect } | null> {
  const [row] = await db.select().from(googleCalendarTokens).limit(1);
  if (!row) return null;

  // Check if token is expired (with 5 min buffer)
  const expiresAt = new Date(row.expiresAt).getTime();
  const now = Date.now();

  if (now > expiresAt - 5 * 60 * 1000) {
    // Refresh
    try {
      const refreshed = await refreshAccessToken(row.refreshToken);
      const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

      await db
        .update(googleCalendarTokens)
        .set({
          accessToken: refreshed.access_token,
          expiresAt: newExpiry,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(googleCalendarTokens.id, row.id));

      return { accessToken: refreshed.access_token, tokenRow: { ...row, accessToken: refreshed.access_token, expiresAt: newExpiry } };
    } catch {
      return null;
    }
  }

  return { accessToken: row.accessToken, tokenRow: row };
}

// Google Calendar API helpers
async function gcalFetch(path: string, accessToken: string, options?: RequestInit) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return res;
}

interface GCalEvent {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
}

export function crmEventToGcalEvent(event: {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt?: string | null;
  allDay?: number | null;
  status?: string;
}): GCalEvent {
  const gcalEvent: GCalEvent = {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    start: {},
    end: {},
  };

  if (event.allDay) {
    const startDate = event.startAt.slice(0, 10);
    const endDate = event.endAt ? event.endAt.slice(0, 10) : startDate;
    // Google Calendar all-day end is exclusive — add 1 day
    const endParts = endDate.split("-").map(Number);
    const endPlusOne = new Date(endParts[0], endParts[1] - 1, endParts[2] + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    gcalEvent.start = { date: startDate };
    gcalEvent.end = { date: `${endPlusOne.getFullYear()}-${pad(endPlusOne.getMonth() + 1)}-${pad(endPlusOne.getDate())}` };
  } else {
    // Send local time — Google will use the calendar's default timezone
    gcalEvent.start = { dateTime: event.startAt };
    gcalEvent.end = { dateTime: event.endAt || event.startAt };
  }

  if (event.status === "cancelled") {
    gcalEvent.status = "cancelled";
  }

  return gcalEvent;
}

export async function pushEventToGoogle(
  accessToken: string,
  calendarId: string,
  crmEvent: {
    id: number;
    title: string;
    description?: string | null;
    location?: string | null;
    startAt: string;
    endAt?: string | null;
    allDay?: number | null;
    status?: string;
    googleEventId?: string | null;
  }
) {
  const gcalEvent = crmEventToGcalEvent(crmEvent);

  let res;
  if (crmEvent.googleEventId) {
    // Update existing
    res = await gcalFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${crmEvent.googleEventId}`,
      accessToken,
      { method: "PUT", body: JSON.stringify(gcalEvent) }
    );
  } else {
    // Create new
    res = await gcalFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      accessToken,
      { method: "POST", body: JSON.stringify(gcalEvent) }
    );
  }

  if (!res.ok) {
    const err = await res.text();
    console.error("Google Calendar push failed:", err);
    await db
      .update(calendarEvents)
      .set({ syncStatus: "error", updatedAt: new Date().toISOString() })
      .where(eq(calendarEvents.id, crmEvent.id));
    return null;
  }

  const data = await res.json();

  // Update CRM event with Google ID
  await db
    .update(calendarEvents)
    .set({
      googleEventId: data.id,
      googleCalendarId: calendarId,
      syncStatus: "synced",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(calendarEvents.id, crmEvent.id));

  return data;
}

export async function deleteEventFromGoogle(
  accessToken: string,
  calendarId: string,
  googleEventId: string
) {
  const res = await gcalFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`,
    accessToken,
    { method: "DELETE" }
  );
  return res.ok;
}

export async function pullEventsFromGoogle(
  accessToken: string,
  calendarId: string,
  lastSyncAt?: string | null
) {
  const params = new URLSearchParams({
    maxResults: "100",
    singleEvents: "true",
    orderBy: "updated",
  });

  if (lastSyncAt) {
    params.set("updatedMin", lastSyncAt);
  } else {
    // First sync: only get future events
    params.set("timeMin", new Date().toISOString());
  }

  const res = await gcalFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    accessToken
  );

  if (!res.ok) return [];

  const data = await res.json();
  return data.items || [];
}
