import { NextRequest, NextResponse } from "next/server";
import { withVisitor } from "@/lib/api";
import { getComplimentStats, rememberPlaces } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { DISTRICTS, parseCoordinates } from "@/lib/geo";
import { searchNearby } from "@/lib/places";

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
    const district = params.get("district") || undefined;
    if (district && !DISTRICTS.includes(district))
      throw new AppError("請選擇台北市的行政區。", 400);
    const result = await searchNearby(point, district);
    const ids = result.restaurants.map((restaurant) => restaurant.id);
    await rememberPlaces(ids);
    const stats = await getComplimentStats(ids, visitorId);
    return NextResponse.json({
      ...result,
      restaurants: result.restaurants.map((restaurant) => ({
        ...restaurant,
        ...stats.get(restaurant.id),
      })),
    });
  });
}
