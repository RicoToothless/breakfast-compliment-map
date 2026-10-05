import { NextRequest, NextResponse } from "next/server";
import { getAuth, isLoginConfigured } from "@/lib/auth";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

async function handle(request: NextRequest) {
  try {
    if (request.nextUrl.pathname.endsWith("/sign-in/social") && !isLoginConfigured()) {
      throw new AppError("登入暫時無法使用，請稍後再試。");
    }
    return await getAuth().handler(request);
  } catch (error) {
    console.error("Authentication request failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "登入暫時無法使用，請稍後再試。" }, {
      status: error instanceof AppError ? error.status : 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

export const GET = handle;
export const POST = handle;
