import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { getAuthenticatedUser } from "@/lib/auth";
import { cookies } from "next/headers";

const IMPERSONATE_COOKIE = "x-impersonate-user-id";

// GET: List all users (admin only)
export async function GET() {
  const authUser = await getAuthenticatedUser();
  if (authUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await db.select().from(userProfiles);
  return NextResponse.json(users);
}

// POST: Start impersonating a user
export async function POST(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  if (authUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { targetUserId } = body;

  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATE_COOKIE, targetUserId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 4, // 4 hours
  });

  return NextResponse.json({ ok: true, impersonating: targetUserId });
}

// DELETE: Stop impersonating
export async function DELETE() {
  const authUser = await getAuthenticatedUser();
  if (authUser.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATE_COOKIE);

  return NextResponse.json({ ok: true });
}
