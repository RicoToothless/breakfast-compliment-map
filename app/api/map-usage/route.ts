import { NextRequest, NextResponse } from "next/server";
import { withVisitor } from "@/lib/api";
import { reserveGoogleRequest } from "@/lib/db";
import { AppError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  return withVisitor(request, async () => {
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
      throw new AppError("地圖暫時無法使用，請稍後再試。");
    await reserveGoogleRequest("maps-dynamic");
    return NextResponse.json({ allowed: true });
  });
}
