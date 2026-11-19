import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buyers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { geocodeAddress } from "@/lib/geocode";
import { withAuth, readJson } from "@/lib/api-handler";
import { idSchema, parseWith } from "@/lib/validation";

const MAX_AREAS_PER_REQUEST = 25;

interface GeocodedArea {
  name: string;
  lat: number;
  lng: number;
  type: "zip" | "city" | "county" | "other";
}

/**
 * GET - Return all buyers with their geocoded zone data for the map
 */
export const GET = withAuth(async ({ user: authUser }) => {
  const allBuyers = await db.select().from(buyers)
    .where(eq(buyers.userId, authUser.effectiveId));

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
});

/**
 * POST - Geocode a buyer's areas and update their record
 * Body: { buyerId: number }
 */
export const POST = withAuth(async ({ req, user: authUser }) => {
  const { buyerId } = parseWith(z.object({ buyerId: idSchema }), await readJson(req));

  // Fetch the buyer (scoped to user)
  const [buyer] = await db.select().from(buyers)
    .where(and(eq(buyers.id, buyerId), eq(buyers.userId, authUser.effectiveId)));
  if (!buyer) {
    return NextResponse.json({ error: "Buyer not found" }, { status: 404 });
  }

  const criteria = buyer.buyCriteria ? JSON.parse(buyer.buyCriteria) : {};
  const areasStr: string = criteria.areas || "";

  if (!areasStr.trim()) {
    return NextResponse.json({ geocoded: 0 });
  }

  // Split, trim and drop repeats (ignoring letter case, first spelling wins).
  const seen = new Set<string>();
  const areaParts: string[] = [];
  for (const part of areasStr.split(",")) {
    const area = part.trim();
    if (!area || seen.has(area.toLowerCase())) continue;
    seen.add(area.toLowerCase());
    areaParts.push(area);
  }

  // Each lookup waits about a second (the geocoder's rate limit), so one
  // request looks up at most MAX_AREAS_PER_REQUEST areas and reports the rest
  // as skipped, instead of running for most of an hour.
  const toLookUp = areaParts.slice(0, MAX_AREAS_PER_REQUEST);
  const geocodedAreas: GeocodedArea[] = [];

  for (const area of toLookUp) {
    const isZip = /^\d{5}(-\d{4})?$/.test(area);
    const isCounty = /county$/i.test(area);
    const type: GeocodedArea["type"] = isZip ? "zip" : isCounty ? "county" : "city";

    let query: string;
    if (isZip) {
      query = `${area}, USA`;
    } else if (isCounty) {
      query = `${area}, USA`;
    } else {
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

    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  const updatedCriteria = {
    ...criteria,
    geocodedAreas,
  };

  await db
    .update(buyers)
    .set({ buyCriteria: JSON.stringify(updatedCriteria) })
    .where(and(eq(buyers.id, buyerId), eq(buyers.userId, authUser.effectiveId)));

  return NextResponse.json({
    geocoded: geocodedAreas.length,
    total: areaParts.length,
    skipped: areaParts.length - toLookUp.length,
  });
});
