import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export interface AuthUser {
  id: string;
  effectiveId: string;
  email: string;
  role: "user" | "admin";
  isImpersonating: boolean;
  impersonatingEmail?: string;
}

const IMPERSONATE_COOKIE = "x-impersonate-user-id";

export async function getAuthenticatedUser(): Promise<AuthUser> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  // Get or auto-create profile
  let profile = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.id, user.id))
    .limit(1)
    .then((rows) => rows[0]);

  if (!profile) {
    const rows = await db
      .insert(userProfiles)
      .values({
        id: user.id,
        email: user.email!,
        role: "user",
      })
      .returning();
    profile = rows[0];
  }

  const result: AuthUser = {
    id: user.id,
    effectiveId: user.id,
    email: profile.email,
    role: profile.role as "user" | "admin",
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
