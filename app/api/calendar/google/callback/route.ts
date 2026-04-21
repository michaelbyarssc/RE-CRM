import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google-calendar";
import { db } from "@/lib/db";
import { googleCalendarTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";

  if (error) {
    return NextResponse.redirect(
      `${baseUrl}/settings?google_error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${baseUrl}/settings?google_error=no_code`
    );
  }

  try {
    const authUser = await getAuthenticatedUser();
    const tokens = await exchangeCodeForTokens(code);

    // Clear existing tokens for this user only
    await db.delete(googleCalendarTokens).where(eq(googleCalendarTokens.userId, authUser.effectiveId));

    // Store new tokens
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await db.insert(googleCalendarTokens).values({
      userId: authUser.effectiveId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      calendarId: "primary",
      syncEnabled: 1,
    });

    return NextResponse.redirect(`${baseUrl}/settings?google_success=true`);
  } catch (err) {
    console.error("Google Calendar OAuth error:", err);
    return NextResponse.redirect(
      `${baseUrl}/settings?google_error=token_exchange_failed`
    );
  }
}
