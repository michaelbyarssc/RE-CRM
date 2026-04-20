import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google-calendar";
import { db } from "@/lib/db";
import { googleCalendarTokens } from "@/lib/db/schema";

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
    const tokens = await exchangeCodeForTokens(code);

    // Clear any existing tokens (single-user CRM)
    await db.delete(googleCalendarTokens);

    // Store new tokens
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await db.insert(googleCalendarTokens).values({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      calendarId: "primary", // Default to primary calendar
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
