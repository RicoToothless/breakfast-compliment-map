import { NextRequest, NextResponse } from "next/server";
import { withVisitor } from "@/lib/api";
import { getComplimentStats, leaderboardIds } from "@/lib/db";
import { placeDetails } from "@/lib/places";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withVisitor(request, async (visitorId) => {
    const ids = await leaderboardIds();
    const restaurants = [];
    // Keep provider calls bounded; one live Details lookup per top-ten shop.
    for (const id of ids) {
      const restaurant = await placeDetails(id);
      if (restaurant) restaurants.push(restaurant);
    }
    const stats = await getComplimentStats(ids, visitorId);
    return NextResponse.json({
      restaurants: restaurants.map((restaurant) => ({
        ...restaurant,
        ...stats.get(restaurant.id),
      })),
    });
  });
}
