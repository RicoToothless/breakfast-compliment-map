import { NextRequest, NextResponse } from "next/server";
import { withVisitor } from "@/lib/api";
import { getComplimentStats, rememberPlaces } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { placeDetails } from "@/lib/places";
import { createVoteToken } from "@/lib/voting";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return withVisitor(request, async (visitorId) => {
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(id))
      throw new AppError("請提供有效的店家。", 400);
    const restaurant = await placeDetails(id);
    if (!restaurant)
      throw new AppError("這家店目前無法顯示，請選擇另一家店。", 404);
    await rememberPlaces([id]);
    const stats = await getComplimentStats([id], null);
    return NextResponse.json({
      restaurant: {
        ...restaurant,
        ...stats.get(id),
        voteToken: createVoteToken(id, restaurant.location, visitorId),
      },
    });
  });
}
