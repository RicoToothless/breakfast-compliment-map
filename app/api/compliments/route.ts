import { NextRequest, NextResponse } from "next/server";
import { withVisitor } from "@/lib/api";
import { recordCompliment } from "@/lib/db";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withVisitor(request, async (visitorId) => {
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    ) {
      throw new AppError("請使用 JSON 送出紀錄。", 415);
    }
    // Read a bounded body rather than trusting the client Content-Length header.
    const reader = request.body?.getReader();
    if (!reader) throw new AppError("請選擇一家餐廳。", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        throw new AppError("送出的資料太大。", 413);
      }
      chunks.push(value);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AppError("送出的資料格式不正確。", 400);
    }
    if (
      !body ||
      typeof body.placeId !== "string" ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(body.placeId)
    ) {
      throw new AppError("請選擇一家餐廳。", 400);
    }
    const result = await recordCompliment(body.placeId, visitorId);
    if (!result) throw new AppError("找不到這家餐廳，請重新搜尋。", 404);
    return NextResponse.json(result);
  });
}
