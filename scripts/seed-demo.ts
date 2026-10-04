import assert from "node:assert/strict";
import { getDb } from "../lib/db";
import { searchNearby } from "../lib/places";

// Reserved demo visitor IDs let us remove only synthetic votes.
const demoPrefix = "de000000-0000-4000-8000-";
const totals = [187, 163, 142, 128, 109, 94, 81, 73, 62, 54,
  47, 39, 32, 26, 21, 17, 13, 9, 6, 3];
const args = process.argv.slice(2);
assert(args.every((arg) => arg === "--clear"), "Usage: npm run db:demo -- [--clear]");
assert(process.env.DATABASE_URL, "Missing DATABASE_URL");
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname),
  "Demo votes are only allowed in a local database.",
);

const db = getDb();
try {
  const restaurants = new Map<string, string>();
  if (!args.includes("--clear")) {
    // Cover the default map and the Taipei Arena neighborhood.
    for (const point of [{ lat: 25.033, lng: 121.5654 }, { lat: 25.052, lng: 121.549 }]) {
      const result = await searchNearby(point);
      for (const restaurant of result.restaurants.slice(0, 10)) {
        restaurants.set(restaurant.id, restaurant.name);
      }
    }
    assert(restaurants.size >= 10, "Not enough live restaurants; no votes were changed.");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM compliments WHERE visitor_id::text LIKE $1", [`${demoPrefix}%`]);
    let total = 0;
    let rank = 0;
    for (const [id, name] of restaurants) {
      const count = totals[rank++];
      await client.query("INSERT INTO restaurants (place_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
      const result = await client.query(`
        INSERT INTO compliments (place_id, visitor_id, taipei_day, created_at)
        SELECT $1, ($3 || lpad(vote::text, 12, '0'))::uuid,
          (now() AT TIME ZONE 'Asia/Taipei')::date - (1 + vote % 30),
          (((now() AT TIME ZONE 'Asia/Taipei')::date - (1 + vote % 30))
            + time '09:00' + (vote % 120) * interval '1 minute') AT TIME ZONE 'Asia/Taipei'
        FROM generate_series(1, $2::integer) AS vote
        ON CONFLICT (place_id, visitor_id, taipei_day) DO NOTHING
      `, [id, count, demoPrefix]);
      assert.equal(result.rowCount, count, "Demo vote count mismatch.");
      total += count;
      console.log(`${name}: ${count} demo votes`);
    }
    await client.query("COMMIT");
    console.log(`Done: ${total} demo votes across ${restaurants.size} restaurants. Real votes preserved.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await db.end();
}
