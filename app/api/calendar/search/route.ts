import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, buyers } from "@/lib/db/schema";
import { ilike, or, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const type = searchParams.get("type"); // "leads" or "buyers"

  if (type === "buyers") {
    const results = await db
      .select({
        id: buyers.id,
        name: buyers.name,
        company: buyers.company,
        phone: buyers.phone,
      })
      .from(buyers)
      .where(
        q
          ? or(
              ilike(buyers.name, `%${q}%`),
              ilike(buyers.company, `%${q}%`)
            )
          : undefined
      )
      .limit(20);

    return NextResponse.json(results);
  }

  // Default: search leads
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
    .where(
      q
        ? or(
            ilike(leads.firstName, `%${q}%`),
            ilike(leads.lastName, `%${q}%`),
            ilike(leads.propertyAddress, `%${q}%`),
            ilike(leads.phone, `%${q}%`)
          )
        : undefined
    )
    .limit(20);

  return NextResponse.json(results);
}
