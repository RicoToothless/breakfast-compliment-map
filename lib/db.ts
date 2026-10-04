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
  visitorId: string,
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
      coalesce(bool_or(c.visitor_id = $2::uuid AND
        c.taipei_day = (now() AT TIME ZONE 'Asia/Taipei')::date), false) AS today
    FROM restaurants r LEFT JOIN compliments c USING (place_id)
    WHERE r.place_id = ANY($1::text[]) GROUP BY r.place_id
  `,
    [ids, visitorId],
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
  visitorId: string,
  db = getDb(),
) {
  const result = await db.query(
    `
    INSERT INTO compliments (place_id, visitor_id)
    SELECT place_id, $2::uuid FROM restaurants WHERE place_id = $1
    ON CONFLICT (place_id, visitor_id, taipei_day) DO NOTHING RETURNING id
  `,
    [placeId, visitorId],
  );
  const stats = await getComplimentStats([placeId], visitorId, db);
  const restaurant = stats.get(placeId);
  if (!restaurant) return null;
  return { ...restaurant, alreadyRecorded: result.rowCount === 0 };
}

export async function leaderboardIds(db = getDb()): Promise<string[]> {
  const { rows } = await db.query<{ place_id: string }>(`
    SELECT place_id FROM compliments GROUP BY place_id
    ORDER BY count(*) DESC, min(created_at) ASC, place_id ASC LIMIT 10
  `);
  return rows.map((row) => row.place_id);
}

export async function reserveGoogleRequest(db = getDb()) {
  const limit = Number(process.env.MAX_GOOGLE_REQUESTS_PER_DAY ?? 500);
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("MAX_GOOGLE_REQUESTS_PER_DAY must be a positive integer.");
  const result = await db.query(
    `
    INSERT INTO api_usage (usage_key, requests) VALUES ('google-places', 1)
    ON CONFLICT (usage_key, usage_day) DO UPDATE SET requests = api_usage.requests + 1
    WHERE api_usage.requests < $1 RETURNING requests
  `,
    [limit],
  );
  if (!result.rowCount)
    throw new AppError("今天的餐廳查詢額度已用完，請明天再來。", 429);
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
