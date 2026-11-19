import { NextResponse } from "next/server";
import { GoogleTokenError, exchangeCodeForTokens, storeGoogleTokens } from "@/lib/google-calendar";
import {
  NONCE_COOKIE,
  nonceCookieOptions,
  nonceHash,
  OAUTH_PENDING_KEY,
  verifyOAuthState,
} from "@/lib/google-oauth-state";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api-handler";
import { tryKeyRing } from "@/lib/secrets";

// Order matters: (1) signed in or 401 (withAuth); (2) the nonce cookie is
// cleared on every answer; (3) the state must be one this server signed for
// this user in this browser, not expired, or nothing else happens; (4) the
// user's pending-flow marker for this state is deleted, and if there was none
// (already used, or replaced by a newer flow) nothing else happens; (5) only
// then is Google's own error looked at; (6) the code must be present;
// (7) without the encryption key the flow stops here, before Google is
// contacted, so no code is spent and no token is stored; (8) the code is
// exchanged and both tokens are stored encrypted (storeGoogleTokens).
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
  if (!nonce || !verifyOAuthState(params.get("state"), nonce, user.id)) {
    return toSettings("google_error=invalid_state");
  }

  // Use the state up now, whatever happens next.
  const consumed = await db
    .delete(settings)
    .where(
      and(
        eq(settings.userId, user.id),
        eq(settings.key, OAUTH_PENDING_KEY),
        eq(settings.value, nonceHash(nonce))
      )
    )
    .returning({ id: settings.id });
  if (consumed.length === 0) {
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

  if (!tryKeyRing()) {
    return toSettings("google_error=encryption_not_configured");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await storeGoogleTokens(user.id, tokens);
    return toSettings("google_success=true");
  } catch (err) {
    // Fixed text, the user id and the error name only: never a token or Google's answer.
    console.error(
      err instanceof GoogleTokenError
        ? `Google Calendar connect failed: user ${user.id}, status ${err.status}, code ${err.code ?? "none"}.`
        : `Google Calendar connect failed: user ${user.id}, ${err instanceof Error ? err.name : "unknown error"}.`
    );
    return toSettings("google_error=token_exchange_failed");
  }
});
