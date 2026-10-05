import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createVoteToken, verifyVoteEligibility } from "../lib/voting";
import { TAIPEI_CENTER } from "../lib/geo";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");

test("voting requires a signed shop receipt without GPS", () => {
  const visitor = randomUUID();
  const token = createVoteToken("shop", TAIPEI_CENTER, visitor);
  assert.doesNotThrow(() => verifyVoteEligibility(token, "shop", visitor));
  assert.throws(() => verifyVoteEligibility(token, "other", visitor), {
    status: 400,
  });
  assert.throws(() => verifyVoteEligibility(token, "shop", randomUUID()), {
    status: 400,
  });
  assert.throws(() => verifyVoteEligibility(token + "bad", "shop", visitor), {
    status: 400,
  });
});

test("expired receipts cannot authorize votes", () => {
  const visitor = randomUUID();
  const realNow = Date.now;
  let token: string;
  try {
    Date.now = () => realNow() - 16 * 60_000;
    token = createVoteToken("shop", TAIPEI_CENTER, visitor);
  } finally {
    Date.now = realNow;
  }
  assert.throws(() => verifyVoteEligibility(token!, "shop", visitor), {
    status: 409,
  });
});
