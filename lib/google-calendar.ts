import "server-only";

import { db } from "@/lib/db";
import { googleCalendarTokens, calendarEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  GOOGLE_ENCRYPTION_NOT_CONFIGURED_MESSAGE,
  encryptToken,
  readToken,
  requireKeyRing,
  type TokenColumn,
} from "@/lib/secrets";

// Google access and refresh tokens are stored encrypted (lib/secrets). Every
// read and write of the two token columns goes through this file, and a
// decrypted refresh token never leaves it. Old plain-text rows still work and
// are encrypted on the next write.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/google/callback`
  : "http://localhost:3001/api/calendar/google/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

/** The Google consent URL. `state` comes from lib/google-oauth-state.ts. */
export function getGoogleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Google's token endpoint said no. Carries only the HTTP status and Google's
 * short error code (for example invalid_grant), never Google's free text, so
 * callers can log these two fields safely.
 */
export class GoogleTokenError extends Error {
  constructor(
    public readonly step: "exchange" | "refresh",
    public readonly status: number,
    public readonly code: string | null
  ) {
    super(`Google token ${step} failed`);
    this.name = "GoogleTokenError";
  }
}

/** Google's `error` field, only if the answer is JSON and it is a short code of letters and underscores. */
async function googleErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body?.error === "string" && /^[a-z_]{1,64}$/.test(body.error) ? body.error : null;
  } catch {
    return null;
  }
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
    // Google's answer is not passed on or logged: only the status and the short code.
    throw new GoogleTokenError("exchange", res.status, await googleErrorCode(res));
  }

  return (await res.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    token_type?: unknown;
  };
}

export type GoogleTokenRow = Omit<typeof googleCalendarTokens.$inferSelect, "accessToken" | "refreshToken">;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function expiryFrom(expiresIn: unknown): string {
  const seconds = typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Replace this user's Google tokens with new ones, encrypted. Both tokens must
 * be non-empty strings. Throws 503 when the encryption key is not configured.
 */
export async function storeGoogleTokens(
  userId: string,
  tokens: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
) {
  if (!userId) throw new Error("storeGoogleTokens needs a user id");
  if (!nonEmpty(tokens.access_token) || !nonEmpty(tokens.refresh_token)) {
    throw new Error("Google did not return both tokens");
  }
  const ring = requireKeyRing(GOOGLE_ENCRYPTION_NOT_CONFIGURED_MESSAGE);
  const accessToken = encryptToken(ring, userId, "access_token", tokens.access_token);
  const refreshToken = encryptToken(ring, userId, "refresh_token", tokens.refresh_token);
  const expiresAt = expiryFrom(tokens.expires_in);
  await db.transaction(async (tx) => {
    // Clear existing tokens for this user only
    await tx.delete(googleCalendarTokens).where(eq(googleCalendarTokens.userId, userId));
    await tx.insert(googleCalendarTokens).values({
      userId,
      accessToken,
      refreshToken,
      expiresAt,
      calendarId: "primary",
      syncEnabled: 1,
    });
  });
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
    throw new GoogleTokenError("refresh", res.status, await googleErrorCode(res));
  }

  return (await res.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
}

/**
 * The user's Google access token (decrypted, refreshed if it is about to
 * expire) and the token row WITHOUT the two token fields. Null when the user
 * has not connected, the refresh fails, or a saved token cannot be decrypted
 * (the user can reconnect). Throws 503 when a token row exists but the
 * encryption key is not configured.
 */
export async function getValidToken(userId: string): Promise<{ accessToken: string; tokenRow: GoogleTokenRow } | null> {
  // A user id is required: there is no "any user's token" fallback.
  if (!userId) throw new Error("getValidToken needs a user id");
  const [row] = await db.select().from(googleCalendarTokens)
    .where(eq(googleCalendarTokens.userId, userId)).limit(1);
  if (!row) return null;

  const ring = requireKeyRing(GOOGLE_ENCRYPTION_NOT_CONFIGURED_MESSAGE);
  const { accessToken: storedAccess, refreshToken: storedRefresh, ...tokenRow } = row;
  const read = (column: TokenColumn, stored: string) => {
    const result = readToken(ring, userId, column, stored);
    if (result.state === "readable") return result;
    // A key version that is not configured is logged once per version by
    // lib/secrets; the user is treated as not connected and can reconnect.
    if (result.state === "locked") return null;
    console.error(`Google Calendar token could not be read: user ${userId}, field ${column}.`);
    return null;
  };
  const access = read("access_token", storedAccess);
  const refresh = read("refresh_token", storedRefresh);
  if (!access || !refresh) return null;

  // Check if token is expired (with 5 min buffer)
  const expiresAt = new Date(row.expiresAt).getTime();
  const now = Date.now();

  if (!(now > expiresAt - 5 * 60 * 1000)) {
    return { accessToken: access.value, tokenRow };
  }

  // Refresh
  let refreshed;
  try {
    refreshed = await refreshAccessToken(refresh.value);
  } catch (err) {
    // One line: user id, status and Google's short code, or the error name.
    console.error(
      err instanceof GoogleTokenError
        ? `Google token refresh failed: user ${userId}, status ${err.status}, code ${err.code ?? "none"}.`
        : `Google token refresh failed: user ${userId}, ${errorName(err)}.`
    );
    return null;
  }
  if (!nonEmpty(refreshed.access_token)) return null;
  const newExpiry = expiryFrom(refreshed.expires_in);
  const nowISO = new Date().toISOString();

  await db
    .update(googleCalendarTokens)
    .set({
      accessToken: encryptToken(ring, userId, "access_token", refreshed.access_token),
      // An old plain-text refresh token is encrypted on this write too.
      ...(refresh.legacy ? { refreshToken: encryptToken(ring, userId, "refresh_token", refresh.value) } : {}),
      expiresAt: newExpiry,
      updatedAt: nowISO,
    })
    .where(and(eq(googleCalendarTokens.id, row.id), eq(googleCalendarTokens.userId, userId)));

  return { accessToken: refreshed.access_token, tokenRow: { ...tokenRow, expiresAt: newExpiry, updatedAt: nowISO } };
}

/** A short, safe description of an error for logs: its name only, never its text. */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown error";
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
    const endParts = endDate.split("-").map(Number);
    const endPlusOne = new Date(endParts[0], endParts[1] - 1, endParts[2] + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    gcalEvent.start = { date: startDate };
    gcalEvent.end = { date: `${endPlusOne.getFullYear()}-${pad(endPlusOne.getMonth() + 1)}-${pad(endPlusOne.getDate())}` };
  } else {
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
    userId: string;
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
    res = await gcalFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(crmEvent.googleEventId)}`,
      accessToken,
      { method: "PUT", body: JSON.stringify(gcalEvent) }
    );
  } else {
    res = await gcalFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      accessToken,
      { method: "POST", body: JSON.stringify(gcalEvent) }
    );
  }

  if (!res.ok) {
    // Fixed text and ids only: Google's answer is not logged.
    console.error(`Google Calendar push failed: status ${res.status}, event ${crmEvent.id}.`);
    await db
      .update(calendarEvents)
      .set({ syncStatus: "error", updatedAt: new Date().toISOString() })
      .where(and(eq(calendarEvents.id, crmEvent.id), eq(calendarEvents.userId, crmEvent.userId)));
    return null;
  }

  const data = await res.json();

  await db
    .update(calendarEvents)
    .set({
      googleEventId: data.id,
      googleCalendarId: calendarId,
      syncStatus: "synced",
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(calendarEvents.id, crmEvent.id), eq(calendarEvents.userId, crmEvent.userId)));

  return data;
}

export async function deleteEventFromGoogle(
  accessToken: string,
  calendarId: string,
  googleEventId: string
) {
  const res = await gcalFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    accessToken,
    { method: "DELETE" }
  );
  return res.ok;
}

/**
 * Auto-sync a single CRM event to Google Calendar immediately.
 * Now requires userId to find the correct token.
 */
export async function autoSyncEvent(crmEvent: {
  id: number;
  userId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt?: string | null;
  allDay?: number | null;
  status?: string;
  googleEventId?: string | null;
}) {
  try {
    const token = await getValidToken(crmEvent.userId);
    if (!token) return;

    const { accessToken, tokenRow } = token;
    const calendarId = tokenRow.calendarId || "primary";
    await pushEventToGoogle(accessToken, calendarId, crmEvent);
  } catch (err) {
    console.error(`Auto-sync to Google failed: event ${crmEvent.id}, ${errorName(err)}.`);
  }
}

/**
 * Auto-delete a CRM event from Google Calendar immediately.
 * Now requires userId to find the correct token.
 */
export async function autoDeleteFromGoogle(googleEventId: string | null | undefined, userId: string) {
  if (!googleEventId) return;
  try {
    const token = await getValidToken(userId);
    if (!token) return;

    const { accessToken, tokenRow } = token;
    const calendarId = tokenRow.calendarId || "primary";
    await deleteEventFromGoogle(accessToken, calendarId, googleEventId);
  } catch (err) {
    console.error(`Auto-delete from Google failed: user ${userId}, ${errorName(err)}.`);
  }
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
