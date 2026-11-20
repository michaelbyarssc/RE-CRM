import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import {
  buildPagePolicy,
  makeNonce,
  OTHER_POLICY_HEADER,
  POLICY_HEADER,
} from "@/lib/security/csp.mjs";

export async function proxy(request: NextRequest) {
  // A new nonce and page policy for every request (see lib/security/csp.mjs).
  const nonce = makeNonce();
  const policy = buildPagePolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  // Next.js reads the nonce from the policy on the request while it renders
  // the page. Remove any policy header the visitor sent, so ours is the only
  // one it can read. updateSession forwards these request headers.
  request.headers.delete(OTHER_POLICY_HEADER);
  request.headers.set(POLICY_HEADER, policy);
  request.headers.set("x-nonce", nonce);

  const response = await updateSession(request);
  // On every answer the proxy gives: pages and redirects.
  response.headers.set(POLICY_HEADER, policy);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - api routes (protected separately if needed)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api).*)",
  ],
};
