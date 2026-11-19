import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { withAuth, readJson } from "@/lib/api-handler";
import { NotFoundError } from "@/lib/errors";
import { parseWith } from "@/lib/validation";
import { cookies } from "next/headers";

const IMPERSONATE_COOKIE = "x-impersonate-user-id";

const startSchema = z.object({ targetUserId: z.string().min(1).max(100) });

// GET: List all users (admin only)
export const GET = withAuth(async () => {
  const users = await db
    .select({ id: userProfiles.id, email: userProfiles.email, fullName: userProfiles.fullName, role: userProfiles.role })
    .from(userProfiles);
  return NextResponse.json(users);
}, { admin: true });

// POST: Start impersonating a user (admin only). The target must exist.
export const POST = withAuth(async ({ req }) => {
  const { targetUserId } = parseWith(startSchema, await readJson(req));

  const [target] = await db.select({ id: userProfiles.id }).from(userProfiles)
    .where(eq(userProfiles.id, targetUserId)).limit(1);
  if (!target) throw new NotFoundError("User not found");

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATE_COOKIE, target.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 4, // 4 hours
  });

  return NextResponse.json({ ok: true, impersonating: target.id });
}, { admin: true });

// DELETE: Stop impersonating (admin only)
export const DELETE = withAuth(async () => {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATE_COOKIE);
  return NextResponse.json({ ok: true });
}, { admin: true });
