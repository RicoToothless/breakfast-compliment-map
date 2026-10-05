import { NextRequest, NextResponse } from "next/server";
import { withVisitor } from "@/lib/api";
import { getAuthenticatedUser, isLoginConfigured } from "@/lib/auth";
import { hasVotedToday } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withVisitor(request, async () => {
    const user = await getAuthenticatedUser(request.headers);
    return NextResponse.json({
      authenticated: Boolean(user),
      loginAvailable: isLoginConfigured(),
      votedToday: user ? await hasVotedToday(user.id) : false,
    });
  });
}
