import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import type { Coordinates } from "./types";

const RECEIPT_LIFETIME = 15 * 60_000;

function signature(payload: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new AppError("投票暫時無法使用，請稍後再試。");
  return createHmac("sha256", secret)
    .update(`breakfast-vote:${payload}`)
    .digest();
}

// A signed receipt carries Google's restaurant position for 15 minutes without
// storing it in PostgreSQL or making another Places call at voting time.
export function createVoteToken(
  id: string,
  location: Coordinates,
  visitorId: string,
) {
  const payload = Buffer.from(
    JSON.stringify({
      id,
      location,
      visitorId,
      expires: Date.now() + RECEIPT_LIFETIME,
    }),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyVoteEligibility(
  token: unknown,
  id: string,
  visitorId: string,
) {
  if (typeof token !== "string" || token.length > 1024)
    throw new AppError("請先開啟店家資訊再投票。", 400);
  const parts = token.split(".");
  if (parts.length !== 2)
    throw new AppError("店家驗證失敗，請重新開啟店家資訊。", 400);
  const expected = signature(parts[0]);
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new AppError("店家驗證失敗，請重新開啟店家資訊。", 400);
  let receipt;
  try {
    receipt = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new AppError("店家驗證失敗，請重新開啟店家資訊。", 400);
  }
  if (receipt.id !== id || receipt.visitorId !== visitorId)
    throw new AppError("店家驗證失敗，請重新開啟店家資訊。", 400);
  if (!Number.isFinite(receipt.expires) || receipt.expires <= Date.now())
    throw new AppError("店家驗證已過期，請重新載入店家資訊。", 409);
}
