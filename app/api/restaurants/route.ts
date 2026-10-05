import { NextRequest, NextResponse } from "next/server";
import { withVisitor } from "@/lib/api";
import {
  getComplimentStats,
  rememberPlaces,
  reserveRestaurantSearch,
} from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  MIN_SEARCH_ZOOM,
  parseCoordinates,
  VOTING_RADIUS_METERS,
} from "@/lib/geo";
import { searchNearby } from "@/lib/places";
import { createVoteToken } from "@/lib/voting";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withVisitor(request, async (visitorId) => {
    const params = request.nextUrl.searchParams;
    let point;
    try {
      point = parseCoordinates(params.get("lat"), params.get("lng"));
    } catch {
      throw new AppError("請提供有效的位置。", 400);
    }
    const query = (params.get("q") ?? "").trim();
    const mode = params.get("mode") ?? "browse";
    const zoom = Number(params.get("zoom"));
    if (
      query.length > 80 ||
      !["browse", "vote"].includes(mode) ||
      params.has("district")
    )
      throw new AppError("請提供有效的搜尋條件。", 400);
    if (mode === "vote" && query)
      throw new AppError("投票清單只能搜尋目前位置附近。", 400);
    if (
      mode === "browse" &&
      !query &&
      (!Number.isFinite(zoom) || zoom < MIN_SEARCH_ZOOM || zoom > 22)
    )
      throw new AppError("請先放大地圖，或輸入店名再搜尋。", 400);
    await reserveRestaurantSearch(visitorId);
    const radius =
      mode === "vote" || query
        ? VOTING_RADIUS_METERS
        : Math.max(75, VOTING_RADIUS_METERS / 2 ** (zoom - MIN_SEARCH_ZOOM));
    const result = await searchNearby(point, query, radius);
    const ids = result.restaurants.map((restaurant) => restaurant.id);
    await rememberPlaces(ids);
    const stats = await getComplimentStats(ids, null);
    return NextResponse.json({
      ...result,
      restaurants: result.restaurants.map((restaurant) => ({
        ...restaurant,
        ...stats.get(restaurant.id),
        voteToken: createVoteToken(
          restaurant.id,
          restaurant.location,
          visitorId,
        ),
      })),
    });
  });
}
