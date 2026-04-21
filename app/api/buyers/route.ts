import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buyers } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET() {
  const authUser = await getAuthenticatedUser();
  const allBuyers = await db.select().from(buyers)
    .where(eq(buyers.userId, authUser.effectiveId))
    .orderBy(sql`${buyers.createdAt} DESC`);
  return NextResponse.json(allBuyers);
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  const body = await req.json();
  const [buyer] = await db
    .insert(buyers)
    .values({
      userId: authUser.effectiveId,
      name: body.name,
      company: body.company,
      phone: body.phone,
      email: body.email,
      buyCriteria: body.buyCriteria ? JSON.stringify(body.buyCriteria) : null,
      notes: body.notes,
    })
    .returning();
  return NextResponse.json(buyer);
}

export async function DELETE(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(buyers).where(and(eq(buyers.id, id), eq(buyers.userId, authUser.effectiveId)));
  return NextResponse.json({ ok: true });
}
