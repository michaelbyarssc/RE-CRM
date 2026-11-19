import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buyers } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { withAuth, readJson } from "@/lib/api-handler";
import { optionalText, parseId, parseWith } from "@/lib/validation";

const buyerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: optionalText(200),
  phone: optionalText(50),
  email: optionalText(320),
  buyCriteria: z
    .object({ areas: z.string().max(5000).optional(), priceRange: z.string().max(200).optional() })
    .nullable()
    .optional(),
  notes: optionalText(5000),
});

export const GET = withAuth(async ({ user }) => {
  const allBuyers = await db.select().from(buyers)
    .where(eq(buyers.userId, user.effectiveId))
    .orderBy(sql`${buyers.createdAt} DESC`);
  return NextResponse.json(allBuyers);
});

export const POST = withAuth(async ({ req, user }) => {
  const body = parseWith(buyerSchema, await readJson(req));
  const [buyer] = await db
    .insert(buyers)
    .values({
      userId: user.effectiveId,
      name: body.name,
      company: body.company,
      phone: body.phone,
      email: body.email,
      buyCriteria: body.buyCriteria ? JSON.stringify(body.buyCriteria) : null,
      notes: body.notes,
    })
    .returning();
  return NextResponse.json(buyer);
});

export const DELETE = withAuth(async ({ req, user }) => {
  const id = parseId(req.nextUrl.searchParams.get("id"));
  await db.delete(buyers).where(and(eq(buyers.id, id), eq(buyers.userId, user.effectiveId)));
  return NextResponse.json({ ok: true });
});
