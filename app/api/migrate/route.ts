import { NextRequest, NextResponse } from "next/server";
import { runMigrations, backfillUserData } from "@/lib/db/migrate";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    // Run schema migrations
    const result = await runMigrations();

    // After migration, check if we need to do the backfill
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

    // Check if any profile exists
    const existingProfiles = await db.select().from(userProfiles).limit(1);

    if (existingProfiles.length === 0) {
      // First migration: create admin profile for current user
      await db.insert(userProfiles).values({
        id: user.id,
        email: user.email!,
        role: "admin",
      });

      // Backfill all existing data to this admin user
      const backfillResult = await backfillUserData(user.id);

      return NextResponse.json({
        ...result,
        backfilled: true,
        adminUserId: user.id,
        adminEmail: user.email,
        backfillResult,
      });
    }

    return NextResponse.json({
      ...result,
      backfill: "skipped",
      reason: "Profiles already exist",
      profileCount: existingProfiles.length,
      userId: user.id,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
