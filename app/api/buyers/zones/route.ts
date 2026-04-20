import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buyers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { geocodeAddress } from "@/lib/geocode";

interface GeocodedArea {
  name: string;
  lat: number;
  lng: number;
  type: "zip" | "city" | "county" | "other";
}

/**
 * GET - Return all buyers with their geocoded zone data for the map
 */
export async function GET() {
  const allBuyers = await db.select().from(buyers);

  const zones = allBuyers
    .map((buyer) => {
      const criteria = buyer.buyCriteria ? JSON.parse(buyer.buyCriteria) : null;
      if (!criteria?.geocodedAreas || criteria.geocodedAreas.length === 0) return null;

      return {
        id: buyer.id,
        name: buyer.name,
        company: buyer.company,
        phone: buyer.phone,
        email: buyer.email,
        priceRange: criteria.priceRange || null,
        areas: criteria.areas || "",
        geocodedAreas: criteria.geocodedAreas as GeocodedArea[],
      };
    })
    .filter(Boolean);

  return NextResponse.json(zones);
}

/**
 * POST - Geocode a buyer's areas and update their record
 * Body: { buyerId: number }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const buyerId = body.buyerId;

  if (!buyerId) {
    return NextResponse.json({ error: "buyerId required" }, { status: 400 });
  }

  // Fetch the buyer
  const [buyer] = await db.select().from(buyers).where(eq(buyers.id, buyerId));
  if (!buyer) {
    return NextResponse.json({ error: "Buyer not found" }, { status: 404 });
  }

  const criteria = buyer.buyCriteria ? JSON.parse(buyer.buyCriteria) : {};
  const areasStr: string = criteria.areas || "";

  if (!areasStr.trim()) {
    return NextResponse.json({ geocoded: 0 });
  }

  // Parse areas: split by comma, detect type (zip, city, county)
  const areaParts = areasStr
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const geocodedAreas: GeocodedArea[] = [];

  for (const area of areaParts) {
    // Detect type
    const isZip = /^\d{5}(-\d{4})?$/.test(area);
    const isCounty = /county$/i.test(area);
    const type: GeocodedArea["type"] = isZip ? "zip" : isCounty ? "county" : "city";

    // Build geocode query
    let query: string;
    if (isZip) {
      query = `${area}, USA`;
    } else if (isCounty) {
      query = `${area}, USA`;
    } else {
      // Could be a city name - try with state context from other areas
      query = `${area}, USA`;
    }

    const result = await geocodeAddress(query);
    if (result) {
      geocodedAreas.push({
        name: area,
        lat: result.lat,
        lng: result.lon,
        type,
      });
    }

    // Rate limit for Nominatim
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  // Update buyer with geocoded areas
  const updatedCriteria = {
    ...criteria,
    geocodedAreas,
  };

  await db
    .update(buyers)
    .set({ buyCriteria: JSON.stringify(updatedCriteria) })
    .where(eq(buyers.id, buyerId));

  return NextResponse.json({ geocoded: geocodedAreas.length, total: areaParts.length });
}
