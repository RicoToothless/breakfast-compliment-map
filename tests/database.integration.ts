import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { getMigrations } from "better-auth/db/migration";
import { makeSignature } from "better-auth/crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import {
  allowVisitorRequest,
  getComplimentStats,
  getDb,
  hasVotedToday,
  leaderboardIds,
  recordCompliment,
  rememberPlaces,
  reserveGoogleRequest,
  reserveRestaurantSearch,
} from "../lib/db";
import { GET as nearbyGet } from "../app/api/restaurants/route";
import { GET as leaderboardGet } from "../app/api/leaderboard/route";
import { POST as complimentPost } from "../app/api/compliments/route";
import { GET as votingStatusGet } from "../app/api/voting-status/route";
import { POST as authPost } from "../app/api/auth/[...all]/route";
import { POST as mapUsagePost } from "../app/api/map-usage/route";
import { googleRequest } from "../lib/places";
import { createVoteToken } from "../lib/voting";
import { GET as detailGet } from "../app/api/restaurants/[id]/route";
import { getAuth, getAuthOptions } from "../lib/auth";

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
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "test-only-map-key";
  process.env.MAX_GOOGLE_MAP_LOADS_PER_MONTH = "10000";
  process.env.MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH = "5000";
  process.env.MAX_GOOGLE_PLACES_DETAILS_PER_MONTH = "5000";
  process.env.BETTER_AUTH_URL = "http://localhost:3050";
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-only-not-a-real-secret";
  const db = getDb();
  const sessionCookies = new Map<string, string>();
  async function createSessionCookie(userId: string) {
    const context = await getAuth().$context;
    const session = await context.internalAdapter.createSession(userId);
    assert.ok(session);
    const signature = await makeSignature(
      session.token,
      process.env.BETTER_AUTH_SECRET!,
    );
    return `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;
  }
  async function createUser() {
    const context = await getAuth().$context;
    const user = await context.internalAdapter.createUser(
      {
        name: "Test voter",
        email: `${randomUUID()}@example.test`,
        emailVerified: true,
      },
      { method: "oauth", oauth: { providerId: "google", profile: {} } },
    );
    sessionCookies.set(user.id, await createSessionCookie(user.id));
    return user.id;
  }
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
    origin = "http://localhost:3050",
    authCookie = sessionCookies.get(visitor),
  ) {
    if (path.startsWith("/api/restaurants?")) path += "&zoom=16";
    if (
      path === "/api/compliments" &&
      body &&
      "placeId" in body &&
      typeof body.placeId === "string"
    )
      body = { ...voteBody(body.placeId, visitor), ...body };
    return new NextRequest(`http://localhost:3050${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        cookie: [`breakfast-visitor=${visitor}`, authCookie]
          .filter(Boolean)
          .join("; "),
        origin,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  function voteBody(placeId: string, visitorId: string) {
    const location = { lat: 25.033, lng: 121.5654 };
    return {
      placeId,
      voteToken: createVoteToken(placeId, location, visitorId),
    };
  }
  try {
    await (await getMigrations(getAuthOptions())).runMigrations();
    await db.query(
      await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
    );
    await t.test(
      "twenty simultaneous votes across different shops count once per account",
      async () => {
        const visitor = await createUser();
        await rememberPlaces(["concurrent-shop", "concurrent-other-shop"], db);
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            recordCompliment(
              index % 2 ? "concurrent-shop" : "concurrent-other-shop",
              visitor,
              db,
            ),
          ),
        );
        assert.equal(
          results.filter((result) => !result?.alreadyRecorded).length,
          1,
        );
        const stats = await getComplimentStats(
          ["concurrent-shop", "concurrent-other-shop"],
          visitor,
          db,
        );
        assert.equal(
          [...stats.values()].reduce(
            (total, shop) => total + shop.compliments,
            0,
          ),
          1,
        );
        assert.equal(await hasVotedToday(visitor, db), true);
        assert.equal(
          (await recordCompliment("concurrent-shop", await createUser(), db))
            ?.alreadyRecorded,
          false,
        );
        assert.equal(await recordCompliment("unknown-shop", visitor, db), null);
      },
    );
    await t.test(
      "a different Taipei day allows another compliment",
      async () => {
        const visitor = await createUser();
        await rememberPlaces(["daily-shop"], db);
        await recordCompliment("daily-shop", visitor, db);
        await db.query(
          "UPDATE compliments SET taipei_day = taipei_day - 1 WHERE place_id = 'daily-shop'",
        );
        assert.equal(await hasVotedToday(visitor, db), false);
        assert.equal(
          (await recordCompliment("daily-shop", visitor, db))?.compliments,
          2,
        );
        assert.equal(await hasVotedToday(visitor, db), true);
        assert.ok((await leaderboardIds(db)).includes("daily-shop"));
      },
    );
    await t.test(
      "nearby results join real DB counts; no restaurant names or GPS are persisted",
      async () => {
        const visitor = await createUser();
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
          (await leaders.json()).entries.some(
            (shop: { id: string; compliments: number }) =>
              shop.id === fixture.id && shop.compliments === 1,
          ),
        );
      },
    );
    await t.test(
      "votes use the actual Host despite NextURL loopback normalization",
      async () => {
        await rememberPlaces(["loopback-shop"], db);
        for (const host of ["127.0.0.1:3050", "localhost:3050", "[::1]:3050"]) {
          const visitor = await createUser();
          function vote(origin?: string, fetchSite = "same-origin") {
            return new NextRequest(`http://${host}/api/compliments`, {
              method: "POST",
              headers: {
                host,
                ...(origin ? { origin } : {}),
                "sec-fetch-site": fetchSite,
                cookie: `breakfast-visitor=${visitor}; ${sessionCookies.get(visitor)}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(voteBody("loopback-shop", visitor)),
            });
          }
          assert.equal(vote(`http://${host}`).nextUrl.hostname, "localhost");
          const response = await complimentPost(vote(`http://${host}`));
          assert.equal(response.status, 200);
          assert.equal((await response.json()).complimentedToday, true);
          const duplicate = await complimentPost(vote(`http://${host}`));
          assert.equal((await duplicate.json()).alreadyRecorded, true);
          for (const origin of [
            undefined,
            "https://other.example",
            "http://127.0.0.1:3001",
          ]) {
            assert.equal((await complimentPost(vote(origin))).status, 403);
          }
          assert.equal(
            (await complimentPost(vote(`http://${host}`, "cross-site"))).status,
            403,
          );
        }
      },
    );
    await t.test(
      "bad GPS, unknown restaurants, cross-site writes and failed Google calls surface errors",
      async () => {
        const visitor = await createUser();
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
      "public browsing needs no login; anonymous or forged sessions cannot vote",
      async () => {
        const visitor = randomUUID();
        const status = await votingStatusGet(
          request("/api/voting-status", visitor),
        );
        assert.deepEqual(await status.json(), {
          authenticated: false,
          votedToday: false,
          loginAvailable: true,
        });
        assert.equal(
          (
            await nearbyGet(
              request("/api/restaurants?lat=25.033&lng=121.5654", visitor),
            )
          ).status,
          200,
        );
        assert.equal(
          (await leaderboardGet(request("/api/leaderboard", visitor))).status,
          200,
        );
        assert.equal(
          (
            await complimentPost(
              request("/api/compliments", visitor, { placeId: fixture.id }),
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await complimentPost(
              request(
                "/api/compliments",
                visitor,
                { placeId: fixture.id },
                undefined,
                "better-auth.session_token=forged",
              ),
            )
          ).status,
          401,
        );
      },
    );
    await t.test(
      "two valid sessions for one account share the daily limit; logout cannot reset it",
      async () => {
        const userId = await createUser();
        const firstCookie = sessionCookies.get(userId)!;
        const secondCookie = await createSessionCookie(userId);
        await rememberPlaces(["device-one-shop", "device-two-shop"], db);
        const before = await votingStatusGet(
          request(
            "/api/voting-status",
            randomUUID(),
            undefined,
            undefined,
            firstCookie,
          ),
        );
        assert.equal((await before.json()).votedToday, false);
        const results = await Promise.all([
          complimentPost(
            request(
              "/api/compliments",
              randomUUID(),
              { placeId: "device-one-shop" },
              undefined,
              firstCookie,
            ),
          ),
          complimentPost(
            request(
              "/api/compliments",
              randomUUID(),
              { placeId: "device-two-shop", userId: randomUUID() },
              undefined,
              secondCookie,
            ),
          ),
        ]);
        assert.ok(results.every((result) => result.status === 200));
        const data = await Promise.all(results.map((result) => result.json()));
        assert.equal(
          data.filter((result) => !result.alreadyRecorded).length,
          1,
        );
        const after = await votingStatusGet(
          request(
            "/api/voting-status",
            randomUUID(),
            undefined,
            undefined,
            secondCookie,
          ),
        );
        assert.equal((await after.json()).votedToday, true);
        const logout = await authPost(
          request(
            "/api/auth/sign-out",
            randomUUID(),
            {},
            undefined,
            firstCookie,
          ),
        );
        assert.equal(logout.status, 200);
        assert.equal(
          (
            await complimentPost(
              request(
                "/api/compliments",
                randomUUID(),
                { placeId: fixture.id },
                undefined,
                firstCookie,
              ),
            )
          ).status,
          401,
        );
        assert.equal(await hasVotedToday(userId, db), true);
        await db.query(
          'UPDATE auth_session SET "expiresAt" = now() - interval \'1 second\' WHERE "userId" = $1',
          [userId],
        );
        assert.equal(
          (
            await complimentPost(
              request(
                "/api/compliments",
                randomUUID(),
                { placeId: fixture.id },
                undefined,
                secondCookie,
              ),
            )
          ).status,
          401,
        );
        const newLogin = await createSessionCookie(userId);
        const again = await complimentPost(
          request(
            "/api/compliments",
            randomUUID(),
            { placeId: fixture.id },
            undefined,
            newLogin,
          ),
        );
        assert.equal((await again.json()).alreadyRecorded, true);
      },
    );
    await t.test(
      "Google login creates an OAuth redirect and password registration is disabled",
      async () => {
        const response = await authPost(
          request("/api/auth/sign-in/social", randomUUID(), {
            provider: "google",
            callbackURL: "/?vote=1",
          }),
        );
        assert.equal(response.status, 200);
        const data = await response.json();
        const url = new URL(data.url);
        assert.equal(url.hostname, "accounts.google.com");
        assert.equal(
          url.searchParams.get("redirect_uri"),
          "http://localhost:3050/api/auth/callback/google",
        );
        assert.equal(
          url.searchParams.get("client_id"),
          process.env.GOOGLE_CLIENT_ID,
        );
        const signup = await authPost(
          request("/api/auth/sign-up/email", randomUUID(), {
            name: "No password login",
            email: "disabled@example.test",
            password: "not-a-real-password",
          }),
        );
        assert.ok(signup.status >= 400);
      },
    );
    await t.test(
      "legacy demo compliments are preserved without consuming account votes",
      async () => {
        const visitor = randomUUID();
        await rememberPlaces(["legacy-shop", "legacy-other-shop"], db);
        await db.query(
          "INSERT INTO compliments (place_id, visitor_id) VALUES ('legacy-shop', $1), ('legacy-other-shop', $1)",
          [visitor],
        );
        const userId = await createUser();
        assert.equal(await hasVotedToday(userId, db), false);
        assert.equal(
          (await recordCompliment("legacy-shop", userId, db))?.compliments,
          2,
        );
      },
    );
    await t.test(
      "two area queries return up to 120 unique shops; each page is budgeted and repeats make no calls",
      async () => {
        const visitor = randomUUID();
        const before = requests.length;
        const usageBefore = Number(
          (
            await db.query(
              "SELECT coalesce(sum(requests), 0) AS requests FROM google_monthly_usage WHERE usage_key = 'places-search'",
            )
          ).rows[0].requests,
        );
        const fetchFixture = globalThis.fetch;
        let secondAreaOffset = 40;
        globalThis.fetch = async (input, init) => {
          await fetchFixture(input, init);
          const token = requests.at(-1)?.body?.pageToken;
          const page = token === "page-2" ? 1 : token === "page-3" ? 2 : 0;
          const area = requests.at(-1)?.body?.locationRestriction as {
            rectangle: { low: { latitude: number } };
          };
          const offset =
            area.rectangle.low.latitude >= 25.033 ? secondAreaOffset : 0;
          return Response.json({
            places: Array.from({ length: 20 }, (_, index) => ({
              ...fixture,
              id: `paged-shop-${offset + page * 20 + index}`,
            })),
            nextPageToken: `page-${page + 2}`,
          });
        };
        try {
          const response = await nearbyGet(
            request(
              "/api/restaurants?lat=25.033&lng=121.5654&mode=vote",
              visitor,
            ),
          );
          assert.equal(response.status, 200);
          const data = await response.json();
          assert.equal(data.resultLimitReached, true);
          assert.ok(data.restaurants[0].voteToken);
          assert.equal(data.restaurants.length, 100);
          assert.equal(
            new Set(data.restaurants.map((r: { id: string }) => r.id)).size,
            100,
          );
          assert.equal(requests.length, before + 6);
          const pages = requests.slice(before);
          assert.deepEqual(
            pages.map((p) => p.body?.pageToken),
            [undefined, "page-2", "page-3", undefined, "page-2", "page-3"],
          );
          assert.ok(pages.every((p) => p.body?.pageSize === 20));
          assert.ok(pages.every((p) => p.mask === pages[0].mask));
          for (const [index, page] of pages.entries()) {
            const { pageToken, ...body } = page.body!;
            void pageToken;
            const { pageToken: firstToken, ...firstBody } =
              pages[index < 3 ? 0 : 3].body!;
            void firstToken;
            assert.deepEqual(body, firstBody);
          }
          const usageAfter = Number(
            (
              await db.query(
                "SELECT coalesce(sum(requests), 0) AS requests FROM google_monthly_usage WHERE usage_key = 'places-search'",
              )
            ).rows[0].requests,
          );
          assert.equal(usageAfter, usageBefore + 6);
          assert.equal(
            (
              await nearbyGet(
                request("/api/restaurants?lat=25.033&lng=121.5654", visitor),
              )
            ).status,
            429,
          );
          const broad = new NextRequest(
            "http://localhost:3050/api/restaurants?lat=25.033&lng=121.5654&zoom=10",
            { headers: { cookie: `breakfast-visitor=${randomUUID()}` } },
          );
          assert.equal((await nearbyGet(broad)).status, 400);
          assert.equal(
            (
              await nearbyGet(
                request(
                  "/api/restaurants?lat=25.033&lng=121.5654&mode=vote&q=somewhere",
                  randomUUID(),
                ),
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await nearbyGet(
                request(
                  "/api/restaurants?lat=25.033&lng=121.5654&district=信義區",
                  randomUUID(),
                ),
              )
            ).status,
            400,
          );
          assert.equal(requests.length, before + 6);
          secondAreaOffset = 60;
          const secondSearch = await nearbyGet(
            request(
              "/api/restaurants?lat=25.033&lng=121.5654&mode=vote",
              randomUUID(),
            ),
          );
          assert.equal(secondSearch.status, 200);
          const secondData = await secondSearch.json();
          assert.equal(secondData.restaurants.length, 120);
          assert.equal(
            new Set(secondData.restaurants.map((r: { id: string }) => r.id)).size,
            120,
          );
          assert.equal(secondData.resultLimitReached, true);
          // Both halves use three pages; no seventh request is made.
          assert.equal(requests.length, before + 12);
        } finally {
          globalThis.fetch = fetchFixture;
        }
      },
    );
    await t.test(
      "pagination stops before contacting Google when the next page exceeds the monthly budget",
      async () => {
        await db.query("DELETE FROM google_monthly_usage");
        const previousLimit = process.env.MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH;
        const fetchFixture = globalThis.fetch;
        const before = requests.length;
        process.env.MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH = "1";
        globalThis.fetch = async (input, init) => {
          const response = await fetchFixture(input, init);
          return Response.json({
            ...(await response.json()),
            nextPageToken: "second-page",
          });
        };
        try {
          const response = await nearbyGet(
            request("/api/restaurants?lat=25.033&lng=121.5654", randomUUID()),
          );
          assert.equal(response.status, 429);
          const data = await response.json();
          assert.match(data.error, /本月.*搜尋/);
          assert.equal(data.restaurants, undefined);
          assert.equal(requests.length, before + 1);
          assert.equal(
            (
              await db.query(
                "SELECT requests FROM google_monthly_usage WHERE usage_key = 'places-search'",
              )
            ).rows[0].requests,
            1,
          );
        } finally {
          process.env.MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH = previousLimit;
          globalThis.fetch = fetchFixture;
        }
      },
    );
    await t.test(
      "search cooldown is atomic and expires after ten seconds",
      async () => {
        const visitor = randomUUID();
        const results = await Promise.allSettled(
          Array.from({ length: 20 }, () =>
            reserveRestaurantSearch(visitor, db),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        await db.query(
          "UPDATE restaurant_searches SET searched_at = now() - interval '11 seconds' WHERE visitor_id = $1",
          [visitor],
        );
        await reserveRestaurantSearch(visitor, db);
      },
    );
    await t.test(
      "leaderboards make no Google calls; a selected favourite makes one detail lookup",
      async () => {
        const before = requests.length;
        const leaders = await leaderboardGet(
          request("/api/leaderboard", randomUUID()),
        );
        assert.equal(leaders.status, 200);
        assert.ok((await leaders.json()).entries.length);
        assert.equal(requests.length, before);
        const details = await detailGet(
          request(`/api/restaurants/${fixture.id}`, randomUUID()),
          { params: Promise.resolve({ id: fixture.id }) },
        );
        assert.equal(details.status, 200);
        assert.equal(
          (await details.json()).restaurant.name,
          fixture.displayName.text,
        );
        assert.equal(requests.length, before + 1);
      },
    );
    await t.test(
      "voting accepts signed receipts without GPS or Google calls; tampering and repeat votes remain blocked",
      async () => {
        const visitor = await createUser();
        await rememberPlaces(["gps-shop"], db);
        const before = requests.length;
        const valid = voteBody("gps-shop", visitor);
        assert.equal(
          (
            await complimentPost(
              request("/api/compliments", visitor, {
                ...valid,
                voteToken: valid.voteToken + "tampered",
              }),
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await complimentPost(
              request("/api/compliments", visitor, {
                ...valid,
                voteToken: createVoteToken(
                  "other-shop",
                  { lat: 25.033, lng: 121.5654 },
                  visitor,
                ),
              }),
            )
          ).status,
          400,
        );
        assert.equal(await hasVotedToday(visitor, db), false);
        const response = await complimentPost(
          request("/api/compliments", visitor, valid),
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).compliments, 1);
        const repeat = await complimentPost(
          request("/api/compliments", visitor, valid),
        );
        assert.equal(repeat.status, 200);
        assert.equal((await repeat.json()).alreadyRecorded, true);
        assert.equal(requests.length, before);
      },
    );
    await t.test(
      "visitor and three independent monthly Google budgets remain atomic under concurrency",
      async () => {
        const visitor = randomUUID();
        const allowed = await Promise.all(
          Array.from({ length: 25 }, () => allowVisitorRequest(visitor, db)),
        );
        assert.equal(allowed.filter(Boolean).length, 15);
        await db.query("DELETE FROM google_monthly_usage");
        process.env.MAX_GOOGLE_MAP_LOADS_PER_MONTH = "3";
        process.env.MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH = "3";
        process.env.MAX_GOOGLE_PLACES_DETAILS_PER_MONTH = "3";
        for (const usage of [
          "maps-dynamic",
          "places-search",
          "places-details",
        ] as const) {
          const budget = await Promise.allSettled(
            Array.from({ length: 10 }, () => reserveGoogleRequest(usage, db)),
          );
          assert.equal(
            budget.filter((result) => result.status === "fulfilled").length,
            3,
          );
          const rejected = budget.filter(
            (result) => result.status === "rejected",
          );
          assert.equal(rejected.length, 7);
          assert.ok(rejected.every((result) => result.reason.status === 429));
        }
        const counters = await db.query(
          "SELECT requests FROM google_monthly_usage",
        );
        assert.deepEqual(
          counters.rows.map((row) => row.requests),
          [3, 3, 3],
        );
      },
    );
    await t.test(
      "map reservations enforce same-origin writes and stop at the limit",
      async () => {
        await db.query("DELETE FROM google_monthly_usage");
        process.env.MAX_GOOGLE_MAP_LOADS_PER_MONTH = "1";
        const visitor = randomUUID();
        const callsBefore = requests.length;
        const denied = await mapUsagePost(
          request("/api/map-usage", visitor, {}, "https://other.example"),
        );
        assert.equal(denied.status, 403);
        assert.equal(
          (await db.query("SELECT * FROM google_monthly_usage")).rowCount,
          0,
        );
        const allowed = await mapUsagePost(
          request("/api/map-usage", visitor, {}),
        );
        assert.equal(allowed.status, 200);
        assert.deepEqual(await allowed.json(), { allowed: true });
        assert.equal(allowed.headers.get("Cache-Control"), "private, no-store");
        const exhausted = await mapUsagePost(
          request("/api/map-usage", visitor, {}),
        );
        assert.equal(exhausted.status, 429);
        assert.match((await exhausted.json()).error, /本月.*地圖/);
        assert.equal(requests.length, callsBefore);
      },
    );
    await t.test(
      "configured HTTPS origin works behind an HTTP tunnel while other origins are rejected",
      async () => {
        await db.query("DELETE FROM google_monthly_usage");
        process.env.MAX_GOOGLE_MAP_LOADS_PER_MONTH = "2";
        const previousUrl = process.env.BETTER_AUTH_URL;
        const publicOrigin = "https://quota-test.ngrok-free.dev";
        process.env.BETTER_AUTH_URL = publicOrigin;
        function proxiedRequest(origin: string, fetchSite = "same-origin") {
          return new NextRequest("http://localhost:3050/api/map-usage", {
            method: "POST",
            headers: {
              origin,
              host: "localhost:3050",
              "sec-fetch-site": fetchSite,
            },
          });
        }
        try {
          assert.equal(
            (await mapUsagePost(proxiedRequest(publicOrigin))).status,
            200,
          );
          assert.equal(
            (await mapUsagePost(proxiedRequest("https://other.example")))
              .status,
            403,
          );
          assert.equal(
            (await mapUsagePost(proxiedRequest(publicOrigin, "cross-site")))
              .status,
            403,
          );
          assert.equal(
            (await db.query("SELECT requests FROM google_monthly_usage"))
              .rows[0].requests,
            1,
          );
        } finally {
          process.env.BETTER_AUTH_URL = previousUrl;
        }
      },
    );
    await t.test(
      "exhausted search budget stops outbound calls while detail lookups still work",
      async () => {
        await db.query("DELETE FROM google_monthly_usage");
        process.env.MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH = "0";
        process.env.MAX_GOOGLE_PLACES_DETAILS_PER_MONTH = "2";
        const callsBefore = requests.length;
        const blocked = await nearbyGet(
          request("/api/restaurants?lat=25.033&lng=121.5654", randomUUID()),
        );
        assert.equal(blocked.status, 429);
        assert.match((await blocked.json()).error, /本月.*搜尋/);
        assert.equal(requests.length, callsBefore);
        await googleRequest(`places/${fixture.id}?languageCode=zh-TW`, "id");
        assert.equal(requests.length, callsBefore + 1);
        providerFails = true;
        await assert.rejects(() =>
          googleRequest(`places/${fixture.id}?languageCode=zh-TW`, "id"),
        );
        providerFails = false;
        assert.equal(requests.length, callsBefore + 2);
        await assert.rejects(
          () => googleRequest(`places/${fixture.id}?languageCode=zh-TW`, "id"),
          { status: 429 },
        );
        assert.equal(requests.length, callsBefore + 2);
        await assert.rejects(
          () => googleRequest("unknown-endpoint", "id"),
          /no configured monthly budget/,
        );
        assert.equal(requests.length, callsBefore + 2);
      },
    );
    await t.test(
      "Pacific calendar months reset automatically; invalid limits fail closed",
      async () => {
        await db.query("DELETE FROM google_monthly_usage");
        process.env.MAX_GOOGLE_MAP_LOADS_PER_MONTH = "1";
        await db.query(`INSERT INTO google_monthly_usage (usage_key, usage_month, requests)
        VALUES ('maps-dynamic', (date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles') - interval '1 month')::date, 10000)`);
        await reserveGoogleRequest("maps-dynamic", db);
        const counters = await db.query(
          "SELECT requests FROM google_monthly_usage ORDER BY usage_month",
        );
        assert.deepEqual(
          counters.rows.map((row) => row.requests),
          [10000, 1],
        );
        // Taipei's first morning still belongs to the previous Google month.
        const boundary = await db.query(`SELECT date_trunc('month',
        TIMESTAMPTZ '2026-10-01 00:00:00+08' AT TIME ZONE 'America/Los_Angeles')::date::text AS month`);
        assert.equal(boundary.rows[0].month, "2026-09-01");
        for (const value of ["NaN", "-1", "1.5", "2147483648"]) {
          process.env.MAX_GOOGLE_MAP_LOADS_PER_MONTH = value;
          await assert.rejects(
            () => reserveGoogleRequest("maps-dynamic", db),
            /must be an integer/,
          );
        }
        process.env.MAX_GOOGLE_MAP_LOADS_PER_MONTH = "0";
        await assert.rejects(() => reserveGoogleRequest("maps-dynamic", db), {
          status: 429,
        });
        assert.deepEqual(
          (
            await db.query(
              "SELECT requests FROM google_monthly_usage ORDER BY usage_month",
            )
          ).rows.map((row) => row.requests),
          [10000, 1],
        );
      },
    );
    await t.test(
      "migration preserves legacy Places usage and never resets active counters",
      async () => {
        await db.query("DELETE FROM google_monthly_usage");
        await db.query("DELETE FROM api_usage");
        await db.query(
          "INSERT INTO api_usage (usage_key, requests) VALUES ('google-places', 2)",
        );
        const schema = await readFile(
          new URL("../db/schema.sql", import.meta.url),
          "utf8",
        );
        await db.query(schema);
        assert.deepEqual(
          (
            await db.query(
              "SELECT requests FROM google_monthly_usage ORDER BY usage_key",
            )
          ).rows.map((row) => row.requests),
          [2, 2],
        );
        process.env.MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH = "3";
        await reserveGoogleRequest("places-search", db);
        await db.query(schema);
        assert.deepEqual(
          (
            await db.query(
              "SELECT requests FROM google_monthly_usage ORDER BY usage_key",
            )
          ).rows.map((row) => row.requests),
          [2, 3],
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
