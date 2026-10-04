import assert from "node:assert/strict";
import { test } from "node:test";
import {
  distanceMeters,
  nearbyBounds,
  parseCoordinates,
  TAIPEI_CENTER,
} from "../lib/geo";
import { toRestaurant } from "../lib/places";

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

test("distance sorting uses real geographic distance, not coordinate subtraction", () => {
  assert.equal(distanceMeters(TAIPEI_CENTER, TAIPEI_CENTER), 0);
  const north = distanceMeters(TAIPEI_CENTER, {
    ...TAIPEI_CENTER,
    lat: TAIPEI_CENTER.lat + 0.01,
  });
  assert.ok(north > 1100 && north < 1120);
  assert.ok(nearbyBounds(TAIPEI_CENTER));
  assert.equal(nearbyBounds({ lat: 22.63, lng: 120.3 }), null);
  assert.equal(nearbyBounds({ lat: 90, lng: 0 }), null);
});

test("Google content is normalized only for usable Taipei restaurants", () => {
  const place = {
    id: "test-breakfast",
    displayName: { text: "測試早餐店" },
    formattedAddress: "台灣台北市信義區測試路1號",
    location: { latitude: 25.033, longitude: 121.5654 },
    businessStatus: "OPERATIONAL",
  };
  const restaurant = toRestaurant(place);
  assert.equal(restaurant?.name, "測試早餐店");
  assert.deepEqual(restaurant?.location, TAIPEI_CENTER);
  assert.equal(restaurant?.compliments, 0);
  assert.equal(
    toRestaurant({ ...place, formattedAddress: "新北市板橋區測試路1號" }),
    null,
  );
  assert.equal(
    toRestaurant({ ...place, formattedAddress: "臺北市信義區測試路1號" })?.id,
    place.id,
  );
  assert.equal(
    toRestaurant({ ...place, businessStatus: "CLOSED_PERMANENTLY" }),
    null,
  );
  assert.equal(toRestaurant({ ...place, location: undefined }), null);
});
