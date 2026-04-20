import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { isNull, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { geocodeAddress } from "@/lib/geocode";

export async function POST() {
  // Find leads without coordinates
  const ungeocodedLeads = await db
    .select({
      id: leads.id,
      propertyAddress: leads.propertyAddress,
      propertyCity: leads.propertyCity,
      propertyState: leads.propertyState,
      propertyZip: leads.propertyZip,
    })
    .from(leads)
    .where(isNull(leads.latitude))
    .limit(50);

  if (ungeocodedLeads.length === 0) {
    return NextResponse.json({ geocoded: 0, remaining: 0 });
  }

  let geocoded = 0;
  for (const lead of ungeocodedLeads) {
    const fullAddress = [
      lead.propertyAddress,
      lead.propertyCity,
      lead.propertyState,
      lead.propertyZip,
    ]
      .filter(Boolean)
      .join(", ");

    const result = await geocodeAddress(fullAddress);
    if (result) {
      await db.update(leads)
        .set({ latitude: result.lat, longitude: result.lon })
        .where(eq(leads.id, lead.id));
      geocoded++;
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  const [remaining] = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(isNull(leads.latitude));

  return NextResponse.json({
    geocoded,
    remaining: remaining?.count ?? 0,
  });
}

export async function GET() {
  // Return all geocoded leads for the map
  const geocodedLeads = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      propertyAddress: leads.propertyAddress,
      propertyCity: leads.propertyCity,
      propertyState: leads.propertyState,
      propertyZip: leads.propertyZip,
      phone: leads.phone,
      status: leads.status,
      latitude: leads.latitude,
      longitude: leads.longitude,
    })
    .from(leads)
    .where(sql`${leads.latitude} IS NOT NULL AND ${leads.longitude} IS NOT NULL`);

  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads);

  const [ungeocoded] = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(isNull(leads.latitude));

  return NextResponse.json({
    leads: geocodedLeads,
    total: total?.count ?? 0,
    ungeocoded: ungeocoded?.count ?? 0,
  });
}
