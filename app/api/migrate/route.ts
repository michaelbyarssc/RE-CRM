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
    // Auto-detect: get current user and create admin profile + backfill
    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Check if profile exists
        const existing = await db.select().from(userProfiles).limit(1);

        if (existing.length === 0) {
          // First migration: create admin profile for current user
          await db.insert(userProfiles).values({
            id: user.id,
            email: user.email!,
            role: "admin",
          });

          // Backfill all existing data to this admin user
          await backfillUserData(user.id);

          return NextResponse.json({
            ...result,
            backfilled: true,
            adminUserId: user.id,
            adminEmail: user.email,
          });
        }
      }
    } catch (backfillErr) {
      console.error("Backfill step:", backfillErr);
      // Migration succeeded, backfill may fail if already done
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
