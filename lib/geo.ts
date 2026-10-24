import type { Coordinates, MapBounds } from "./types";

export const TAIPEI_CENTER: Coordinates = { lat: 25.033, lng: 121.5654 };
export const VOTING_RADIUS_METERS = 500;
export const MIN_SEARCH_ZOOM = 17;
// Used only by the optional Taipei import script, not by live searches.
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
  const angularRadius = radius / 6_371_000;
  const latitudeDelta = (angularRadius * 180) / Math.PI;
  const south = Math.max(-90, point.lat - latitudeDelta);
  const north = Math.min(90, point.lat + latitudeDelta);
  const reachesPole = south === -90 || north === 90;
  const longitudeDelta = reachesPole
    ? 180
    : (Math.asin(Math.sin(angularRadius) / Math.cos((point.lat * Math.PI) / 180)) *
        180) /
      Math.PI;
  const wrapLongitude = (longitude: number) => ((longitude + 540) % 360) - 180;
  const low = {
    latitude: south,
    longitude: reachesPole ? -180 : wrapLongitude(point.lng - longitudeDelta),
  };
  const high = {
    latitude: north,
    longitude: reachesPole ? 180 : wrapLongitude(point.lng + longitudeDelta),
  };
  return { low, high };
}

function longitudeSpan(bounds: MapBounds): number {
  const span = bounds.east - bounds.west;
  return span < 0 ? span + 360 : span;
}

export function containsCoordinates(bounds: MapBounds, point: Coordinates): boolean {
  const offset = point.lng - bounds.west;
  const longitudeOffset = offset < 0 ? offset + 360 : offset % 360;
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    longitudeOffset <= longitudeSpan(bounds)
  );
}

export function parseMapBounds(
  params: URLSearchParams,
  center: Coordinates,
): MapBounds {
  const low = parseCoordinates(params.get("south"), params.get("west"));
  const high = parseCoordinates(params.get("north"), params.get("east"));
  const bounds = { south: low.lat, west: low.lng, north: high.lat, east: high.lng };
  const width = longitudeSpan(bounds);
  const widestLatitude = Math.max(low.lat, Math.min(0, high.lat));
  if (
    low.lat >= high.lat ||
    width <= 0 ||
    width > 180 ||
    !containsCoordinates(bounds, center) ||
    distanceMeters(
      { lat: widestLatitude, lng: low.lng },
      { lat: widestLatitude, lng: high.lng },
    ) > 5_000 ||
    distanceMeters(low, high) > 5_000
  )
    throw new Error("請縮小搜尋範圍後再試。");
  return bounds;
}
