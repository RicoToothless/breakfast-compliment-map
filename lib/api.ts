import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { allowVisitorRequest } from "./db";
import { AppError } from "./errors";

const COOKIE_NAME = "breakfast-visitor";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function withVisitor(
  request: NextRequest,
  handler: (visitorId: string) => Promise<NextResponse>,
) {
  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  const visitorId = cookie && UUID_PATTERN.test(cookie) ? cookie : randomUUID();
  let response: NextResponse;
  try {
    if (request.method === "POST") {
      // NextURL normalizes loopback IPs to localhost. Keep the browser's Host
      // so a vote from 127.0.0.1 is compared with that same address.
      const expectedOrigin = new URL(request.nextUrl.origin);
      expectedOrigin.host = request.headers.get("host") ?? expectedOrigin.host;
      // An HTTPS tunnel can forward to an HTTP localhost URL. Trust our
      // configured public origin as well, never an arbitrary forwarded host.
      const publicOrigin = process.env.BETTER_AUTH_URL
        ? new URL(process.env.BETTER_AUTH_URL).origin
        : null;
      const origin = request.headers.get("origin");
      if (!origin || (origin !== expectedOrigin.origin && origin !== publicOrigin)) {
        throw new AppError("請從本站送出請求。", 403);
      }
    }
    if (request.headers.get("sec-fetch-site") === "cross-site") {
      throw new AppError("請從本站查詢餐廳。", 403);
    }
    if (!(await allowVisitorRequest(visitorId)))
      throw new AppError("操作太快了，請稍等一分鐘。", 429);
    response = await handler(visitorId);
  } catch (error) {
    if (error instanceof AppError) {
      response = NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    } else {
      // Database/provider errors may contain credentials or private URLs.
      console.error(
        "Breakfast request failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      response = NextResponse.json(
        {
          error: "資料暫時無法讀取，請稍後再試。",
        },
        { status: 503 },
      );
    }
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(COOKIE_NAME, visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || request.nextUrl.protocol === "https:",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return response;
}
