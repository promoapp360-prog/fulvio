import { getSettings } from "./settings";

export async function googleReviewSummary(placeId: string, key: string, request: typeof fetch = fetch) {
  const response = await request(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "rating,userRatingCount,googleMapsUri" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Riepilogo recensioni Google non disponibile");
  const data = await response.json();
  if (!Number.isInteger(data.userRatingCount) || data.userRatingCount < 0 ||
      typeof data.rating !== "number" || data.rating < 0 || data.rating > 5 ||
      typeof data.googleMapsUri !== "string" || !data.googleMapsUri.startsWith("https://")) {
    throw new Error("Riepilogo recensioni Google non valido");
  }
  return { count: data.userRatingCount as number, rating: data.rating as number, googleUrl: data.googleMapsUri as string };
}

let cached: { key: string; at: number; result: Record<string, unknown> } | undefined;
export async function publicReviews() {
  const { reviews } = await getSettings();
  const cacheKey = JSON.stringify(reviews) + Boolean(process.env.GOOGLE_PLACES_API_KEY);
  if (cached?.key === cacheKey && Date.now() - cached.at < 10 * 60_000) return cached.result;
  let result: Record<string, unknown> = { ...reviews, googlePlaceId: undefined, source: "manual" };
  if (reviews.googlePlaceId && process.env.GOOGLE_PLACES_API_KEY) {
    try {
      result = { ...result, ...await googleReviewSummary(reviews.googlePlaceId, process.env.GOOGLE_PLACES_API_KEY), source: "google" };
    } catch {
      result = { ...result, source: "manual-fallback" };
    }
  }
  // Anche i fallimenti vengono memorizzati: niente chiamate ripetute al provider.
  cached = { key: cacheKey, at: Date.now(), result };
  return result;
}
