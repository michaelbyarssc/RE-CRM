import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google-calendar";
import { NONCE_COOKIE, nonceCookieOptions, verifyOAuthState } from "@/lib/google-oauth-state";
import { db } from "@/lib/db";
import { googleCalendarTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withAuth } from "@/lib/api-handler";

// Order matters: (1) signed in or 401 (withAuth); (2) the nonce cookie is
// cleared on every answer; (3) the state must be one this server signed for
// this user in this browser, not expired, or nothing else happens; (4) only
// then is Google's own error looked at; (5) the code is exchanged.
export const GET = withAuth(async ({ req, user }) => {
  const params = req.nextUrl.searchParams;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";

  const finish = (res: NextResponse) => {
    res.cookies.set(NONCE_COOKIE, "", nonceCookieOptions(0));
    return res;
  };
  const toSettings = (query: string) => finish(NextResponse.redirect(`${baseUrl}/settings?${query}`));

  if (user.isImpersonating) {
    return finish(NextResponse.json({ error: "Not available while impersonating" }, { status: 403 }));
  }

  const nonce = req.cookies.get(NONCE_COOKIE)?.value;
  if (!verifyOAuthState(params.get("state"), nonce, user.id)) {
    return toSettings("google_error=invalid_state");
  }

  const error = params.get("error");
  if (error) {
    // Pass on only a short code made of letters and underscores, never free text.
    const code = /^[a-z_]{1,64}$/.test(error) ? error : "oauth_error";
    return toSettings(`google_error=${code}`);
  }

  const code = params.get("code");
  if (!code) {
    return toSettings("google_error=no_code");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Clear existing tokens for this user only
    await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.userId, user.id));

    // Store new tokens
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await db.insert(googleCalendarTokens).values({
      userId: user.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      calendarId: "primary",
      syncEnabled: 1,
    });

    return toSettings("google_success=true");
  } catch (err) {
    console.error("Google Calendar OAuth error:", err);
    return toSettings("google_error=token_exchange_failed");
  }
});
