import { Pool } from "pg";
import { AppError } from "./errors";

const globalDb = globalThis as typeof globalThis & { breakfastPool?: Pool };

export function getDb(): Pool {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL");
    throw new AppError("餐廳資料暫時無法讀取，請稍後再試。");
  }
  globalDb.breakfastPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
  });
  return globalDb.breakfastPool;
}

export async function rememberPlaces(ids: string[], db = getDb()) {
  if (!ids.length) return;
  await db.query(
    "INSERT INTO restaurants (place_id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING",
    [ids],
  );
}

export async function getComplimentStats(
  ids: string[],
  userId: string | null,
  db = getDb(),
) {
  if (!ids.length)
    return new Map<
      string,
      { compliments: number; complimentedToday: boolean }
    >();
  const { rows } = await db.query<{
    place_id: string;
    compliments: number;
    today: boolean;
  }>(
    `
    SELECT r.place_id, count(c.id)::integer AS compliments,
      coalesce(bool_or(c.user_id = $2::uuid AND
        c.taipei_day = (now() AT TIME ZONE 'Asia/Taipei')::date), false) AS today
    FROM restaurants r LEFT JOIN compliments c USING (place_id)
    WHERE r.place_id = ANY($1::text[]) GROUP BY r.place_id
  `,
    [ids, userId],
  );
  return new Map(
    rows.map((row) => [
      row.place_id,
      {
        compliments: row.compliments,
        complimentedToday: row.today,
      },
    ]),
  );
}

export async function recordCompliment(
  placeId: string,
  userId: string,
  db = getDb(),
) {
  const result = await db.query(
    `
    INSERT INTO compliments (place_id, user_id)
    SELECT place_id, $2::uuid FROM restaurants WHERE place_id = $1
    ON CONFLICT (user_id, taipei_day) DO NOTHING RETURNING id
  `,
    [placeId, userId],
  );
  const stats = await getComplimentStats([placeId], userId, db);
  const restaurant = stats.get(placeId);
  if (!restaurant) return null;
  return {
    ...restaurant,
    votedToday: true,
    alreadyRecorded: result.rowCount === 0,
  };
}

export async function hasVotedToday(
  userId: string,
  db = getDb(),
): Promise<boolean> {
  const { rows } = await db.query<{ voted: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1 FROM compliments WHERE user_id = $1::uuid
      AND taipei_day = (now() AT TIME ZONE 'Asia/Taipei')::date
    ) AS voted
  `,
    [userId],
  );
  return rows[0].voted;
}

export async function leaderboardIds(db = getDb()): Promise<string[]> {
  const { rows } = await db.query<{ place_id: string }>(`
    SELECT place_id FROM compliments GROUP BY place_id
    ORDER BY count(*) DESC, min(created_at) ASC, place_id ASC LIMIT 10
  `);
  return rows.map((row) => row.place_id);
}

const GOOGLE_BUDGETS = {
  "maps-dynamic": {
    setting: "MAX_GOOGLE_MAP_LOADS_PER_MONTH",
    defaultLimit: 10_000,
    error: "本月的地圖載入額度已用完，請下個月再來。",
  },
  "places-search": {
    setting: "MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH",
    defaultLimit: 5_000,
    error: "本月的餐廳搜尋額度已用完，請下個月再來。",
  },
  "places-details": {
    setting: "MAX_GOOGLE_PLACES_DETAILS_PER_MONTH",
    defaultLimit: 5_000,
    error: "本月的餐廳詳細資料額度已用完，請下個月再來。",
  },
} as const;

export type GoogleUsage = keyof typeof GOOGLE_BUDGETS;

export async function reserveGoogleRequest(usage: GoogleUsage, db = getDb()) {
  const budget = GOOGLE_BUDGETS[usage];
  const limit = Number(process.env[budget.setting] ?? budget.defaultLimit);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 2_147_483_647)
    throw new Error(
      `${budget.setting} must be an integer between 0 and 2147483647.`,
    );
  // Reserve before contacting Google. A single SQL statement keeps every
  // process within the limit, even when requests arrive at the same time.
  // Google's free allowance resets at midnight on the first, Pacific US time.
  const result = await db.query(
    `
    INSERT INTO google_monthly_usage (usage_key, requests)
    SELECT $1, 1 WHERE $2::integer > 0
    ON CONFLICT (usage_key, usage_month) DO UPDATE
      SET requests = google_monthly_usage.requests + 1
    WHERE google_monthly_usage.requests < $2 RETURNING requests
  `,
    [usage, limit],
  );
  if (!result.rowCount) throw new AppError(budget.error, 429);
}

export async function allowVisitorRequest(
  visitorId: string,
  db = getDb(),
): Promise<boolean> {
  const result = await db.query(
    `
    INSERT INTO visitor_requests (visitor_id, requests) VALUES ($1::uuid, 1)
    ON CONFLICT (visitor_id) DO UPDATE SET
      requests = CASE WHEN visitor_requests.window_start < now() - interval '1 minute'
        THEN 1 ELSE visitor_requests.requests + 1 END,
      window_start = CASE WHEN visitor_requests.window_start < now() - interval '1 minute'
        THEN now() ELSE visitor_requests.window_start END
    WHERE visitor_requests.window_start < now() - interval '1 minute'
      OR visitor_requests.requests < 15 RETURNING requests
  `,
    [visitorId],
  );
  return Boolean(result.rowCount);
}

export async function reserveRestaurantSearch(visitorId: string, db = getDb()) {
  const result = await db.query(
    `
    INSERT INTO restaurant_searches (visitor_id) VALUES ($1::uuid)
    ON CONFLICT (visitor_id) DO UPDATE SET searched_at = now()
    WHERE restaurant_searches.searched_at <= now() - interval '10 seconds'
    RETURNING visitor_id
  `,
    [visitorId],
  );
  if (!result.rowCount) throw new AppError("請等 10 秒再搜尋。", 429);
}
