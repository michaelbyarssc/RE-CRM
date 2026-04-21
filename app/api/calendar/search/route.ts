import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, buyers } from "@/lib/db/schema";
import { ilike, or, eq, and } from "drizzle-orm";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const authUser = await getAuthenticatedUser();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const type = searchParams.get("type"); // "leads" or "buyers"

  if (type === "buyers") {
    const conditions = [eq(buyers.userId, authUser.effectiveId)];
    if (q) {
      conditions.push(
        or(
          ilike(buyers.name, `%${q}%`),
          ilike(buyers.company, `%${q}%`)
        )!
      );
    }

    const results = await db
      .select({
        id: buyers.id,
        name: buyers.name,
        company: buyers.company,
        phone: buyers.phone,
      })
      .from(buyers)
      .where(and(...conditions))
      .limit(20);

    return NextResponse.json(results);
  }

  // Default: search leads
  const conditions = [eq(leads.userId, authUser.effectiveId)];
  if (q) {
    conditions.push(
      or(
        ilike(leads.firstName, `%${q}%`),
        ilike(leads.lastName, `%${q}%`),
        ilike(leads.propertyAddress, `%${q}%`),
        ilike(leads.phone, `%${q}%`)
      )!
    );
  }

  const results = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      propertyAddress: leads.propertyAddress,
      propertyCity: leads.propertyCity,
      phone: leads.phone,
    })
    .from(leads)
    .where(and(...conditions))
    .limit(20);

  return NextResponse.json(results);
}
