import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuthUrl, getValidToken } from "@/lib/google-calendar";
import { db } from "@/lib/db";
import { googleCalendarTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

// GET: Check connection status or start OAuth flow
export async function GET(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "debug") {
    return NextResponse.json({
      clientIdSet: !!process.env.GOOGLE_CLIENT_ID,
      clientIdPrefix: process.env.GOOGLE_CLIENT_ID?.slice(0, 10) + "...",
      secretSet: !!process.env.GOOGLE_CLIENT_SECRET,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "(not set)",
      redirectUri: process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/google/callback`
        : "http://localhost:3001/api/calendar/google/callback",
      authUrl: getGoogleAuthUrl(),
    });
  }

  if (action === "connect") {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return NextResponse.json(
        { error: "Google Calendar is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to environment variables." },
        { status: 400 }
      );
    }
    const url = getGoogleAuthUrl();
    return NextResponse.redirect(url);
  }

  // Return connection status for this user
  const token = await getValidToken(authUser.effectiveId);
  return NextResponse.json({
    connected: !!token,
    calendarId: token?.tokenRow.calendarId || null,
    syncEnabled: token?.tokenRow.syncEnabled === 1,
    lastSyncAt: token?.tokenRow.lastSyncAt || null,
  });
}

// DELETE: Disconnect Google Calendar for this user
export async function DELETE() {
  const authUser = await getAuthenticatedUser();
  await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.userId, authUser.effectiveId));
  return NextResponse.json({ ok: true });
}
