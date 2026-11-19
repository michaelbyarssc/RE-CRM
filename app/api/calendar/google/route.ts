import { NextResponse } from "next/server";
import { getGoogleAuthUrl, getValidToken } from "@/lib/google-calendar";
import { createOAuthState, NONCE_COOKIE, nonceCookieOptions, STATE_TTL_SECONDS } from "@/lib/google-oauth-state";
import { db } from "@/lib/db";
import { googleCalendarTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withAuth } from "@/lib/api-handler";
import { ForbiddenError } from "@/lib/errors";

const NOT_CONFIGURED =
  "Google Calendar is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to environment variables.";

// GET: Check connection status or start OAuth flow
export const GET = withAuth(async ({ req, user }) => {
  const action = req.nextUrl.searchParams.get("action");

  if (action === "debug") {
    // Admin only, and never the client id or the auth URL.
    if (user.role !== "admin") throw new ForbiddenError();
    return NextResponse.json({
      clientIdSet: !!process.env.GOOGLE_CLIENT_ID,
      secretSet: !!process.env.GOOGLE_CLIENT_SECRET,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "(not set)",
      redirectUri: process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/google/callback`
        : "http://localhost:3001/api/calendar/google/callback",
    });
  }

  if (action === "connect") {
    // An admin acting as someone else must not link their own Google account to that user.
    if (user.isImpersonating) throw new ForbiddenError("Not available while impersonating");
    const oauth = process.env.GOOGLE_CLIENT_ID ? createOAuthState(user.id) : null;
    if (!oauth) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 400 });
    }
    const res = NextResponse.redirect(getGoogleAuthUrl(oauth.state));
    res.cookies.set(NONCE_COOKIE, oauth.nonce, nonceCookieOptions(STATE_TTL_SECONDS));
    return res;
  }

  // Return connection status for this user
  const token = await getValidToken(user.effectiveId);
  return NextResponse.json({
    connected: !!token,
    calendarId: token?.tokenRow.calendarId || null,
    syncEnabled: token?.tokenRow.syncEnabled === 1,
    lastSyncAt: token?.tokenRow.lastSyncAt || null,
  });
});

// DELETE: Disconnect Google Calendar for this user
export const DELETE = withAuth(async ({ user }) => {
  await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.userId, user.effectiveId));
  return NextResponse.json({ ok: true });
});
