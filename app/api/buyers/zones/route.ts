import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buyers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { geocodeAddress } from "@/lib/geocode";
import { withAuth, readJson } from "@/lib/api-handler";
import { idSchema, parseWith } from "@/lib/validation";
import { parseBuyCriteriaObject, readBuyCriteria } from "@/lib/buy-criteria.mjs";
import type { GeocodedArea } from "@/lib/buy-criteria.mjs";

const MAX_AREAS_PER_REQUEST = 25;

/**
 * GET - Return all buyers with their geocoded zone data for the map
 */
export const GET = withAuth(async ({ user: authUser }) => {
  const allBuyers = await db.select().from(buyers)
    .where(eq(buyers.userId, authUser.effectiveId));

  const zones = allBuyers
    .map((buyer) => {
      // A buyer whose saved criteria cannot be read has no zones; the others still show.
      const criteria = readBuyCriteria(buyer.buyCriteria);
      if (!criteria || criteria.geocodedAreas.length === 0) return null;

      return {
        id: buyer.id,
        name: buyer.name,
        company: buyer.company,
        phone: buyer.phone,
        email: buyer.email,
        priceRange: criteria.priceRange || null,
        areas: criteria.areas || "",
        geocodedAreas: criteria.geocodedAreas,
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

  // Unreadable criteria count as no areas, and the saved text is left as it is.
  const areasStr = readBuyCriteria(buyer.buyCriteria)?.areas ?? "";

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
    // Save an area only when the geocoder returned real numbers.
    if (result && Number.isFinite(result.lat) && Number.isFinite(result.lon)) {
      geocodedAreas.push({
        name: area,
        lat: result.lat,
        lng: result.lon,
        type,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  // Every other saved field is kept exactly as stored.
  const updatedCriteria = {
    ...parseBuyCriteriaObject(buyer.buyCriteria),
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
