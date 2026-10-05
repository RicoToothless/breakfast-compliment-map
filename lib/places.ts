import { reserveGoogleRequest } from "./db";
import {
  distanceMeters,
  isTaipeiAddress,
  nearbyBounds,
  TAIPEI_BOUNDS,
  VOTING_RADIUS_METERS,
} from "./geo";
import { AppError } from "./errors";
import type { Coordinates, Restaurant } from "./types";

type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  googleMapsUri?: string;
  businessStatus?: string;
  attributions?: { provider: string; providerUri?: string }[];
};

export const PLACE_FIELDS =
  "id,displayName,formattedAddress,location,googleMapsUri,businessStatus,attributions";

export function toRestaurant(place: GooglePlace): Restaurant | null {
  if (
    !place.displayName?.text ||
    !place.location ||
    !place.formattedAddress ||
    !isTaipeiAddress(place.formattedAddress) ||
    place.businessStatus === "CLOSED_PERMANENTLY"
  )
    return null;
  return {
    id: place.id,
    name: place.displayName.text,
    address: place.formattedAddress,
    location: { lat: place.location.latitude, lng: place.location.longitude },
    googleMapsUri:
      place.googleMapsUri ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName.text)}&query_place_id=${encodeURIComponent(place.id)}`,
    attributions: place.attributions ?? [],
    compliments: 0,
    complimentedToday: false,
  };
}

export async function googleRequest<T>(
  path: string,
  fieldMask: string,
  body?: object,
): Promise<T> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    console.error("Missing GOOGLE_PLACES_API_KEY");
    throw new AppError("餐廳資料暫時無法讀取，請稍後再試。");
  }
  // Fail closed for new endpoints until their billing budget is defined.
  if (
    path !== "places:searchText" &&
    !/^places\/[^/?]+\?languageCode=zh-TW$/.test(path)
  )
    throw new Error("Google Places endpoint has no configured monthly budget.");
  await reserveGoogleRequest(
    path === "places:searchText" ? "places-search" : "places-details",
  );
  const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    // Don't forward provider payloads or URLs; they may include sensitive data.
    console.error(`Google Places returned HTTP ${response.status}`);
    throw new AppError(
      response.status === 429
        ? "Google 餐廳查詢暫時達到上限，請稍後再試。"
        : "餐廳資料暫時無法讀取，請稍後再試。",
    );
  }
  return response.json() as Promise<T>;
}

export async function searchNearby(
  point: Coordinates,
  query = "",
  radius = VOTING_RADIUS_METERS,
) {
  const bounds = query ? TAIPEI_BOUNDS : nearbyBounds(point, radius);
  if (!bounds) return { restaurants: [], resultLimitReached: false };
  // Each query is limited to 60 places. Search two halves, deduplicate, and
  // stop at 120 usable shops. Every page reserves its own monthly slot.
  const fieldMask = `${PLACE_FIELDS.split(",")
    .map((field) => `places.${field}`)
    .join(",")},nextPageToken`;
  const searchBody = {
    textQuery: `台北市 ${query || "早餐店"}`,
    languageCode: "zh-TW",
    regionCode: "TW",
    pageSize: 20,
  };
  const middleLatitude = (bounds.low.latitude + bounds.high.latitude) / 2;
  const areas = [
    { low: bounds.low, high: { ...bounds.high, latitude: middleLatitude } },
    { low: { ...bounds.low, latitude: middleLatitude }, high: bounds.high },
  ];
  const restaurants: Restaurant[] = [];
  const seen = new Set<string>();
  let resultLimitReached = false;
  for (const area of areas) {
    let nextPageToken: string | undefined;
    let queryResults = 0;
    for (let page = 0; page < 3; page++) {
      const response = await googleRequest<{
        places?: GooglePlace[];
        nextPageToken?: string;
      }>("places:searchText", fieldMask, {
        ...searchBody,
        locationRestriction: { rectangle: area },
        ...(nextPageToken ? { pageToken: nextPageToken } : {}),
      });
      queryResults += response.places?.length ?? 0;
      for (const place of response.places ?? []) {
        if (seen.has(place.id)) continue;
        seen.add(place.id);
        const restaurant = toRestaurant(place);
        if (!restaurant) continue;
        restaurant.distanceMeters = distanceMeters(point, restaurant.location);
        if (!query && restaurant.distanceMeters > radius) continue;
        restaurants.push(restaurant);
        if (restaurants.length === 120) break;
      }
      nextPageToken = response.nextPageToken;
      if (!nextPageToken || restaurants.length === 120) break;
    }
    resultLimitReached ||= Boolean(nextPageToken) || queryResults >= 60;
    if (restaurants.length === 120) break;
  }
  return {
    restaurants: restaurants.sort(
      (a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0),
    ),
    resultLimitReached: resultLimitReached || restaurants.length === 120,
  };
}

export async function placeDetails(id: string): Promise<Restaurant | null> {
  return toRestaurant(
    await googleRequest<GooglePlace>(
      `places/${encodeURIComponent(id)}?languageCode=zh-TW`,
      PLACE_FIELDS,
    ),
  );
}
