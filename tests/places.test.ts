import assert from "node:assert/strict";
import { test } from "node:test";
import {
  distanceMeters,
  containsCoordinates,
  nearbyBounds,
  parseCoordinates,
  parseMapBounds,
  TAIPEI_CENTER,
} from "../lib/geo";
import { toRestaurant } from "../lib/places";
import type { MapBounds } from "../lib/types";

test("GPS coordinates reject missing, non-numeric, and out-of-range values", () => {
  for (const [lat, lng] of [
    [null, "121"],
    ["", "121"],
    [" ", "121"],
    ["NaN", "121"],
    ["91", "121"],
    ["25", "181"],
  ]) {
    assert.throws(() => parseCoordinates(lat, lng));
  }
  assert.deepEqual(parseCoordinates("25.033", "121.5654"), TAIPEI_CENTER);
});

test("distances and search bounds use real geographic coordinates", () => {
  assert.equal(distanceMeters(TAIPEI_CENTER, TAIPEI_CENTER), 0);
  const north = distanceMeters(TAIPEI_CENTER, {
    ...TAIPEI_CENTER,
    lat: TAIPEI_CENTER.lat + 0.01,
  });
  assert.ok(north > 1100 && north < 1120);
  for (const point of [
    TAIPEI_CENTER,
    { lat: 22.63, lng: 120.3 },
    { lat: 40.71, lng: -74 },
    { lat: -33.87, lng: 151.21 },
  ]) {
    const bounds = nearbyBounds(point, 500);
    assert.ok(bounds.low.latitude < point.lat);
    assert.ok(bounds.high.latitude > point.lat);
    assert.ok(bounds.low.longitude < point.lng);
    assert.ok(bounds.high.longitude > point.lng);
    assert.ok(
      Math.abs(distanceMeters(point, {
        lat: bounds.high.latitude,
        lng: point.lng,
      }) - 500) < 0.01,
    );
  }
});

test("nearby bounds wrap the date line and remain valid at both poles", () => {
  const wrapped = nearbyBounds({ lat: 0, lng: 179.999 }, 500);
  assert.ok(wrapped.low.longitude > wrapped.high.longitude);
  const viewport = {
    south: wrapped.low.latitude,
    west: wrapped.low.longitude,
    north: wrapped.high.latitude,
    east: wrapped.high.longitude,
  };
  assert.ok(containsCoordinates(viewport, { lat: 0, lng: 179.999 }));
  assert.ok(containsCoordinates(viewport, { lat: 0, lng: -179.999 }));
  assert.ok(containsCoordinates(viewport, { lat: 0, lng: 180 }));
  assert.ok(containsCoordinates(viewport, { lat: 0, lng: -180 }));
  assert.ok(containsCoordinates(viewport, { lat: 0, lng: viewport.west }));
  assert.ok(containsCoordinates(viewport, { lat: 0, lng: viewport.east }));
  assert.equal(containsCoordinates(viewport, { lat: 0, lng: 0 }), false);
  for (const latitude of [90, 89.999, -89.999, -90]) {
    const bounds = nearbyBounds({ lat: latitude, lng: 25 }, 500);
    assert.equal(bounds.low.longitude, -180);
    assert.equal(bounds.high.longitude, 180);
    assert.ok(bounds.low.latitude >= -90);
    assert.ok(bounds.high.latitude <= 90);
    assert.ok(bounds.low.latitude < bounds.high.latitude);
  }
});

function boundsParams(bounds: MapBounds) {
  return new URLSearchParams(
    Object.entries(bounds).map(([edge, value]) => [edge, String(value)]),
  );
}

test("small date-line viewports work while large or misleading rectangles fail", () => {
  const local = { south: 25.03, west: 121.555, north: 25.036, east: 121.576 };
  assert.ok(containsCoordinates(local, { lat: local.north, lng: local.east }));
  assert.ok(containsCoordinates(local, { lat: local.south, lng: local.west }));
  const wrapped = { south: -0.005, west: 179.995, north: 0.005, east: -179.995 };
  for (const lng of [180, -180]) {
    assert.deepEqual(parseMapBounds(boundsParams(wrapped), { lat: 0, lng }), wrapped);
  }
  assert.throws(() => parseMapBounds(boundsParams(wrapped), { lat: 0, lng: 0 }));
  assert.throws(() => parseMapBounds(boundsParams(wrapped), { lat: 1, lng: 180 }));
  for (const bounds of [
    { ...wrapped, west: -179.995, east: 179.995 },
    { ...wrapped, west: 0.001, east: 0 },
    { ...wrapped, west: -180, east: 180 },
    { ...wrapped, west: 180, east: -180 },
    { ...wrapped, west: 0, east: 0 },
    { south: -0.1, west: -0.1, north: 0.1, east: 0.1 },
    { south: 89.96, west: 0, north: 90, east: 180 },
  ]) {
    assert.throws(() =>
      parseMapBounds(boundsParams(bounds), {
        lat: (bounds.south + bounds.north) / 2,
        lng: bounds.west,
      }),
    );
  }
});

test("Google content accepts breakfast shops worldwide and rejects unusable places", () => {
  const place = {
    id: "test-breakfast",
    displayName: { text: "測試早餐店" },
    formattedAddress: "台灣台北市信義區測試路1號",
    location: { latitude: 25.033, longitude: 121.5654 },
    businessStatus: "OPERATIONAL",
    primaryType: "breakfast_restaurant",
  };
  const restaurant = toRestaurant(place);
  assert.equal(restaurant?.name, "測試早餐店");
  assert.deepEqual(restaurant?.location, TAIPEI_CENTER);
  assert.equal(restaurant?.compliments, 0);
  for (const formattedAddress of [
    "新北市板橋區測試路1號",
    "臺北市信義區測試路1號",
    "高雄市苓雅區測試路1號",
    "123 Breakfast St, New York, NY, USA",
  ]) {
    assert.equal(toRestaurant({ ...place, formattedAddress })?.id, place.id);
  }
  assert.equal(
    toRestaurant({ ...place, businessStatus: "CLOSED_PERMANENTLY" }),
    null,
  );
  assert.equal(toRestaurant({ ...place, location: undefined }), null);
  assert.equal(
    toRestaurant({ ...place, primaryType: "brunch_restaurant" })?.id,
    place.id,
  );
  for (const primaryType of [
    "restaurant",
    "japanese_restaurant",
    "hamburger_restaurant",
    "seafood_restaurant",
    "bakery",
    "cafe",
    "event_venue",
    undefined,
  ]) {
    assert.equal(
      toRestaurant({ ...place, primaryType }),
      null,
      `Reject ${primaryType ?? "missing category"}, even with a breakfast shop name.`,
    );
  }
});
