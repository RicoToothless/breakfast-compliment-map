import { NextRequest, NextResponse } from "next/server";
import { withVisitor } from "@/lib/api";
import { getComplimentStats, leaderboardIds } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withVisitor(request, async () => {
    const ids = await leaderboardIds();
    const stats = await getComplimentStats(ids, null);
    return NextResponse.json({
      // Rankings are our own data. Google details are fetched only when a
      // visitor opens a shop that hasn't already been returned by a search.
      entries: ids.map((id) => ({
        id,
        compliments: stats.get(id)?.compliments ?? 0,
      })),
    });
  });
}
