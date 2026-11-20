// Reading a buyer's saved buy criteria (the buyers.buy_criteria text column).
//
// Plain Node ESM with JSDoc types, shared by the API routes, the buyers page
// in the browser and the tests, so the rules exist once.
//
// The app itself always saves JSON, but old data, an import or a manual edit
// can leave text that is not JSON, or JSON of the wrong shape. One such row
// must not break the screens or API answers for every other buyer, so these
// functions never throw.

/**
 * @typedef {"zip" | "city" | "county" | "other"} AreaType
 * @typedef {{ name: string, lat: number, lng: number, type: AreaType }} GeocodedArea
 * @typedef {{ areas?: string, priceRange?: string, geocodedAreas: GeocodedArea[] }} BuyCriteria
 */

const AREA_TYPES = ["zip", "city", "county", "other"];

/**
 * The saved text as a plain object, with every field exactly as stored, or
 * null when the text is empty, is not JSON, or is JSON but not an object
 * (a string, a number, an array or null). Never throws.
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
export function parseBuyCriteriaObject(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * One map area, or null when it cannot be drawn: it needs a text name and a
 * latitude and longitude that are real numbers in range. An unknown type
 * becomes "other".
 * @param {unknown} entry
 * @returns {GeocodedArea | null}
 */
function readGeocodedArea(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const { name, lat, lng, type } = /** @type {Record<string, unknown>} */ (entry);
  if (typeof name !== "string" || name.trim() === "") return null;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const areaType = /** @type {AreaType} */ (
    typeof type === "string" && AREA_TYPES.includes(type) ? type : "other"
  );
  return { name, lat, lng, type: areaType };
}

/**
 * Text for a field shown as text: text as it is, a real number as its digits
 * (a zip code saved as 29301 still shows), anything else undefined.
 * @param {unknown} value
 * @returns {string | undefined}
 */
function readText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * The buy criteria the app can use, or null when the saved text is not a
 * readable criteria object. Fields of the wrong type are left out and the
 * good ones kept: `areas` and `priceRange` when they are text, or a real
 * number turned into text (objects, lists, true or false, null, NaN and
 * Infinity are left out), and only the map areas that can be drawn.
 * `geocodedAreas` is always a list (empty when none are usable). Never throws.
 * @param {unknown} raw
 * @returns {BuyCriteria | null}
 */
export function readBuyCriteria(raw) {
  const stored = parseBuyCriteriaObject(raw);
  if (!stored) return null;
  /** @type {BuyCriteria} */
  const criteria = { geocodedAreas: [] };
  const areas = readText(stored.areas);
  if (areas !== undefined) criteria.areas = areas;
  const priceRange = readText(stored.priceRange);
  if (priceRange !== undefined) criteria.priceRange = priceRange;
  if (Array.isArray(stored.geocodedAreas)) {
    for (const entry of stored.geocodedAreas) {
      const area = readGeocodedArea(entry);
      if (area) criteria.geocodedAreas.push(area);
    }
  }
  return criteria;
}
