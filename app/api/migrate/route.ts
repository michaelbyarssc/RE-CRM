import { NextRequest, NextResponse } from "next/server";
import { runMigrations, backfillUserData } from "@/lib/db/migrate";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    // Run schema migrations
    const result = await runMigrations();

    // Get current user
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({
        ...result,
        backfill: "skipped",
        reason: "No authenticated user found",
        authError: authError?.message || null,
      });
    }

    // Ensure user profile exists and is admin
    const [profile] = await db.select().from(userProfiles)
      .where(eq(userProfiles.id, user.id)).limit(1);

    if (!profile) {
      await db.insert(userProfiles).values({
        id: user.id,
        email: user.email!,
        role: "admin",
      });
    } else if (profile.role !== "admin") {
      await db.update(userProfiles)
        .set({ role: "admin" })
        .where(eq(userProfiles.id, user.id));
    }

    // Always run backfill (safe — only updates rows where user_id IS NULL)
    const backfillResult = await backfillUserData(user.id);

    return NextResponse.json({
      ...result,
      backfilled: true,
      adminUserId: user.id,
      adminEmail: user.email,
      role: "admin",
      backfillResult,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
