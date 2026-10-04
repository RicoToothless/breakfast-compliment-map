import { reserveGoogleRequest } from "./db";
import {
  distanceMeters,
  isTaipeiAddress,
  nearbyBounds,
  TAIPEI_BOUNDS,
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
  await reserveGoogleRequest();
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

export async function searchNearby(point: Coordinates, district?: string) {
  const bounds = district ? TAIPEI_BOUNDS : nearbyBounds(point);
  if (!bounds) return { restaurants: [], resultLimitReached: false };
  const places = new Map<string, Restaurant>();
  let pageToken: string | undefined;
  let resultLimitReached = false;
  for (let page = 0; page < 3; page++) {
    const response = await googleRequest<{
      places?: GooglePlace[];
      nextPageToken?: string;
    }>(
      "places:searchText",
      `${PLACE_FIELDS.split(",")
        .map((field) => `places.${field}`)
        .join(",")},nextPageToken`,
      {
        textQuery: `台北市${district ?? ""} 早餐店`,
        languageCode: "zh-TW",
        regionCode: "TW",
        pageSize: 20,
        locationRestriction: { rectangle: bounds },
        ...(pageToken ? { pageToken } : {}),
      },
    );
    for (const place of response.places ?? []) {
      const restaurant = toRestaurant(place);
      if (!restaurant || (district && !restaurant.address.includes(district)))
        continue;
      restaurant.distanceMeters = distanceMeters(point, restaurant.location);
      if (!district && restaurant.distanceMeters > 3000) continue;
      places.set(restaurant.id, restaurant);
    }
    pageToken = response.nextPageToken;
    resultLimitReached =
      page === 2 &&
      ((response.places?.length ?? 0) === 20 || Boolean(pageToken));
    if (!pageToken) break;
  }
  return {
    restaurants: [...places.values()].sort(
      (a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0),
    ),
    resultLimitReached,
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
