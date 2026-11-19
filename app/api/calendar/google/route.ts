import { NextResponse } from "next/server";
import { getGoogleAuthUrl, getValidToken } from "@/lib/google-calendar";
import {
  createOAuthState,
  NONCE_COOKIE,
  nonceCookieOptions,
  nonceHash,
  OAUTH_PENDING_KEY,
  STATE_TTL_SECONDS,
} from "@/lib/google-oauth-state";
import { db } from "@/lib/db";
import { googleCalendarTokens, settings } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api-handler";
import { ForbiddenError } from "@/lib/errors";
import { keyStatus, tryKeyRing } from "@/lib/secrets";

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
      // The key fingerprint, so the owner can check that the one-off script
      // (scripts/encrypt-existing-secrets.mjs) uses the same key. Never the key.
      settingsKey: keyStatus(),
    });
  }

  if (action === "connect") {
    // An admin acting as someone else must not link their own Google account to that user.
    if (user.isImpersonating) throw new ForbiddenError("Not available while impersonating");
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 400 });
    }
    // Without the encryption key the tokens could not be stored: do not start.
    // This is a full-page navigation, so go back to the settings page (which
    // explains the code), before any state or nonce exists and before Google.
    if (!tryKeyRing()) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
      return NextResponse.redirect(`${baseUrl}/settings?google_error=encryption_not_configured`);
    }
    const oauth = createOAuthState(user.id);
    if (!oauth) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 400 });
    }
    // One pending flow per user: a new flow replaces the old marker, so older states stop working.
    await db.transaction(async (tx) => {
      await tx
        .delete(settings)
        .where(and(eq(settings.userId, user.id), eq(settings.key, OAUTH_PENDING_KEY)));
      await tx.insert(settings).values({ userId: user.id, key: OAUTH_PENDING_KEY, value: nonceHash(oauth.nonce) });
    });
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
