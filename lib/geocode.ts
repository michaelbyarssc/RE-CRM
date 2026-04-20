const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

interface GeoResult {
  lat: number;
  lon: number;
}

export async function geocodeAddress(address: string): Promise<GeoResult | null> {
  try {
    const params = new URLSearchParams({
      q: address,
      format: "json",
      limit: "1",
      countrycodes: "us",
    });

    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: {
        "User-Agent": "RE-CRM-Wholesaler/1.0",
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data.length === 0) return null;

    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
    };
  } catch {
    return null;
  }
}

export async function batchGeocode(
  leads: { id: number; address: string }[],
  onProgress?: (done: number, total: number) => void
): Promise<{ id: number; lat: number; lon: number }[]> {
  const results: { id: number; lat: number; lon: number }[] = [];

  for (let i = 0; i < leads.length; i++) {
    const result = await geocodeAddress(leads[i].address);
    if (result) {
      results.push({ id: leads[i].id, lat: result.lat, lon: result.lon });
    }
    onProgress?.(i + 1, leads.length);

    // Rate limit: 1 request per second for Nominatim
    if (i < leads.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }

  return results;
}
