import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import {
  allowVisitorRequest,
  getComplimentStats,
  getDb,
  leaderboardIds,
  recordCompliment,
  rememberPlaces,
  reserveGoogleRequest,
} from "../lib/db";
import { GET as nearbyGet } from "../app/api/restaurants/route";
import { GET as leaderboardGet } from "../app/api/leaderboard/route";
import { POST as complimentPost } from "../app/api/compliments/route";

test("PostgreSQL and API integration in a disposable schema", async (t) => {
  const testUrl = process.env.TEST_DATABASE_URL;
  assert.ok(testUrl, "Set TEST_DATABASE_URL to a separate test database.");
  const parsed = new URL(testUrl);
  assert.notEqual(
    parsed.pathname,
    new URL(process.env.DATABASE_URL!).pathname,
    "Test and application databases must have different names.",
  );
  const admin = new Pool({ connectionString: testUrl });
  const schemaName = `breakfast_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  parsed.searchParams.set("options", `-c search_path=${schemaName}`);
  process.env.DATABASE_URL = parsed.toString();
  process.env.GOOGLE_PLACES_API_KEY = "test-only-not-a-real-key";
  const db = getDb();
  const originalFetch = globalThis.fetch;
  const requests: { mask: string; body?: Record<string, unknown> }[] = [];
  let providerFails = false;
  const fixture = {
    id: "test-google-breakfast",
    displayName: { text: "測試用早餐店" },
    formattedAddress: "台北市信義區測試路1號",
    location: { latitude: 25.033, longitude: 121.5654 },
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?q=test",
  };
  globalThis.fetch = async (_input, init) => {
    requests.push({
      mask: new Headers(init?.headers).get("X-Goog-FieldMask") ?? "",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (providerFails)
      return Response.json({ error: "not exposed" }, { status: 403 });
    return Response.json(
      init?.method === "POST"
        ? {
            places: [
              fixture,
              {
                ...fixture,
                id: "outside-taipei",
                formattedAddress: "新北市板橋區測試路",
              },
            ],
          }
        : fixture,
    );
  };
  function request(
    path: string,
    visitor: string,
    body?: object,
    origin = "http://localhost:3000",
  ) {
    return new NextRequest(`http://localhost:3000${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        cookie: `breakfast-visitor=${visitor}`,
        origin,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  try {
    await db.query(
      await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
    );
    await t.test(
      "twenty simultaneous clicks from one visitor count once",
      async () => {
        const visitor = randomUUID();
        await rememberPlaces(["concurrent-shop"], db);
        const results = await Promise.all(
          Array.from({ length: 20 }, () =>
            recordCompliment("concurrent-shop", visitor, db),
          ),
        );
        assert.equal(
          results.filter((result) => !result?.alreadyRecorded).length,
          1,
        );
        const stats = await getComplimentStats(
          ["concurrent-shop"],
          visitor,
          db,
        );
        assert.equal(stats.get("concurrent-shop")?.compliments, 1);
        assert.equal(stats.get("concurrent-shop")?.complimentedToday, true);
        await recordCompliment("concurrent-shop", randomUUID(), db);
        assert.equal(
          (await getComplimentStats(["concurrent-shop"], visitor, db)).get(
            "concurrent-shop",
          )?.compliments,
          2,
        );
        assert.equal(await recordCompliment("unknown-shop", visitor, db), null);
      },
    );
    await t.test(
      "a different Taipei day allows another compliment",
      async () => {
        const visitor = randomUUID();
        await rememberPlaces(["daily-shop"], db);
        await recordCompliment("daily-shop", visitor, db);
        await db.query(
          "UPDATE compliments SET taipei_day = taipei_day - 1 WHERE place_id = 'daily-shop'",
        );
        assert.equal(
          (await recordCompliment("daily-shop", visitor, db))?.compliments,
          2,
        );
        assert.equal((await leaderboardIds(db))[0], "concurrent-shop");
      },
    );
    await t.test(
      "nearby results join real DB counts; no restaurant names or GPS are persisted",
      async () => {
        const visitor = randomUUID();
        const response = await nearbyGet(
          request("/api/restaurants?lat=25.033&lng=121.5654", visitor),
        );
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.restaurants.length, 1);
        assert.equal(data.restaurants[0].distanceMeters, 0);
        assert.equal(data.restaurants[0].compliments, 0);
        assert.equal(
          response.headers.get("Cache-Control"),
          "private, no-store",
        );
        const columns = await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'restaurants' ORDER BY ordinal_position",
          [schemaName],
        );
        assert.deepEqual(
          columns.rows.map((row) => row.column_name),
          ["place_id", "discovered_at"],
        );
        assert.ok(!requests[0].mask.includes("rating"));
        const vote = await complimentPost(
          request("/api/compliments", visitor, { placeId: fixture.id }),
        );
        assert.equal(vote.status, 200);
        assert.equal((await vote.json()).compliments, 1);
        const duplicate = await complimentPost(
          request("/api/compliments", visitor, { placeId: fixture.id }),
        );
        assert.equal((await duplicate.json()).alreadyRecorded, true);
        const leaders = await leaderboardGet(
          request("/api/leaderboard", visitor),
        );
        assert.equal(leaders.status, 200);
        assert.ok(
          (await leaders.json()).restaurants.some(
            (shop: { id: string; compliments: number }) =>
              shop.id === fixture.id && shop.compliments === 1,
          ),
        );
      },
    );
    await t.test("votes use the actual Host despite NextURL loopback normalization", async () => {
      await rememberPlaces(["loopback-shop"], db);
      for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
        const visitor = randomUUID();
        function vote(origin?: string, fetchSite = "same-origin") {
          return new NextRequest(`http://${host}/api/compliments`, {
            method: "POST",
            headers: {
              host,
              ...(origin ? { origin } : {}),
              "sec-fetch-site": fetchSite,
              cookie: `breakfast-visitor=${visitor}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ placeId: "loopback-shop" }),
          });
        }
        assert.equal(vote(`http://${host}`).nextUrl.hostname, "localhost");
        const response = await complimentPost(vote(`http://${host}`));
        assert.equal(response.status, 200);
        assert.equal((await response.json()).complimentedToday, true);
        const duplicate = await complimentPost(vote(`http://${host}`));
        assert.equal((await duplicate.json()).alreadyRecorded, true);
        for (const origin of [undefined, "https://other.example", "http://127.0.0.1:3001"]) {
          assert.equal((await complimentPost(vote(origin))).status, 403);
        }
        assert.equal((await complimentPost(vote(`http://${host}`, "cross-site"))).status, 403);
      }
    });
    await t.test(
      "bad GPS, unknown restaurants, cross-site writes and failed Google calls surface errors",
      async () => {
        const visitor = randomUUID();
        assert.equal(
          (await nearbyGet(request("/api/restaurants?lat=&lng=121", visitor)))
            .status,
          400,
        );
        assert.equal(
          (
            await complimentPost(
              request("/api/compliments", visitor, { placeId: "missing" }),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await complimentPost(
              request(
                "/api/compliments",
                visitor,
                { placeId: fixture.id },
                "https://other.example",
              ),
            )
          ).status,
          403,
        );
        providerFails = true;
        const response = await nearbyGet(
          request("/api/restaurants?lat=25.033&lng=121.5654", visitor),
        );
        assert.equal(response.status, 503);
        assert.ok(!(await response.text()).includes("not exposed"));
        providerFails = false;
      },
    );
    await t.test(
      "visitor and shared Google budgets remain atomic under concurrency",
      async () => {
        const visitor = randomUUID();
        const allowed = await Promise.all(
          Array.from({ length: 25 }, () => allowVisitorRequest(visitor, db)),
        );
        assert.equal(allowed.filter(Boolean).length, 15);
        await db.query("DELETE FROM api_usage");
        process.env.MAX_GOOGLE_REQUESTS_PER_DAY = "3";
        const budget = await Promise.allSettled(
          Array.from({ length: 10 }, () => reserveGoogleRequest(db)),
        );
        assert.equal(
          budget.filter((result) => result.status === "fulfilled").length,
          3,
        );
        assert.equal(
          budget.filter((result) => result.status === "rejected").length,
          7,
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await db.end();
    await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);
    await admin.end();
  }
});
