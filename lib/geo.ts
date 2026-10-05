import type { Coordinates } from "./types";

export const TAIPEI_CENTER: Coordinates = { lat: 25.033, lng: 121.5654 };
export const VOTING_RADIUS_METERS = 500;
export const MIN_SEARCH_ZOOM = 16;
// A search envelope, not the city's administrative boundary. Address checks
// below exclude neighboring cities from the search results.
export const TAIPEI_BOUNDS = {
  low: { latitude: 24.95, longitude: 121.45 },
  high: { latitude: 25.22, longitude: 121.67 },
};

export const DISTRICTS = [
  "中正區",
  "大同區",
  "中山區",
  "松山區",
  "大安區",
  "萬華區",
  "信義區",
  "士林區",
  "北投區",
  "內湖區",
  "南港區",
  "文山區",
];

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function parseCoordinates(
  lat: string | null,
  lng: string | null,
): Coordinates {
  if (!lat?.trim() || !lng?.trim()) throw new Error("請提供有效的位置。");
  const point = { lat: Number(lat), lng: Number(lng) };
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  ) {
    throw new Error("請提供有效的位置。");
  }
  return point;
}

export function nearbyBounds(point: Coordinates, radius = 3000) {
  const latitudeDelta = radius / 111_000;
  const longitudeDelta =
    radius / (111_000 * Math.cos((point.lat * Math.PI) / 180));
  const low = {
    latitude: Math.max(TAIPEI_BOUNDS.low.latitude, point.lat - latitudeDelta),
    longitude: Math.max(
      TAIPEI_BOUNDS.low.longitude,
      point.lng - longitudeDelta,
    ),
  };
  const high = {
    latitude: Math.min(TAIPEI_BOUNDS.high.latitude, point.lat + latitudeDelta),
    longitude: Math.min(
      TAIPEI_BOUNDS.high.longitude,
      point.lng + longitudeDelta,
    ),
  };
  if (low.latitude >= high.latitude || low.longitude >= high.longitude)
    return null;
  return { low, high };
}

export function isTaipeiAddress(address: string): boolean {
  return /(?:台北市|臺北市)/u.test(address);
}
