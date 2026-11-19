import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { UnauthorizedError } from "@/lib/errors";

export interface AuthUser {
  id: string;
  effectiveId: string;
  email: string;
  role: "user" | "admin";
  isImpersonating: boolean;
  impersonatingEmail?: string;
}

const IMPERSONATE_COOKIE = "x-impersonate-user-id";

// The user the API route wrapper (lib/api-handler.ts) already authenticated
// for this request, so the data functions do not ask Supabase again.
const requestUser = new AsyncLocalStorage<AuthUser>();

export function runWithAuthUser<T>(user: AuthUser, fn: () => T): T {
  return requestUser.run(user, fn);
}

/**
 * The signed-in user for this request. Throws UnauthorizedError (401) when
 * nobody is signed in. Inside an API route this reuses the user the route
 * wrapper authenticated.
 */
export async function getAuthenticatedUser(): Promise<AuthUser> {
  return requestUser.getStore() ?? (await resolveAuthenticatedUser());
}

/** Authenticate with Supabase and load (or create) the profile. */
export async function resolveAuthenticatedUser(): Promise<AuthUser> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new UnauthorizedError();
  }

  // Get or auto-create the profile. A new profile is always role "user".
  // "on conflict do nothing" makes two parallel first requests safe.
  await db
    .insert(userProfiles)
    .values({
      id: user.id,
      email: user.email ?? user.phone ?? "",
      role: "user",
    })
    .onConflictDoNothing({ target: userProfiles.id });

  const profile = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.id, user.id))
    .limit(1)
    .then((rows) => rows[0]);

  if (!profile) {
    throw new UnauthorizedError();
  }

  const result: AuthUser = {
    id: user.id,
    effectiveId: user.id,
    email: profile.email,
    role: profile.role === "admin" ? "admin" : "user",
    isImpersonating: false,
  };

  // Check for impersonation (admin only)
  if (profile.role === "admin") {
    const cookieStore = await cookies();
    const impersonateId = cookieStore.get(IMPERSONATE_COOKIE)?.value;

    if (impersonateId && impersonateId !== user.id) {
      const target = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.id, impersonateId))
        .limit(1)
        .then((rows) => rows[0]);

      if (target) {
        result.effectiveId = target.id;
        result.isImpersonating = true;
        result.impersonatingEmail = target.email;
      }
    }
  }

  return result;
}
