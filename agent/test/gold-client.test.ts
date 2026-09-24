import { test } from "node:test";
import assert from "node:assert/strict";
import { paxgyPriceUsd, goldMarketStatus } from "../src/equity/goldClient.js";

test("paxgyPriceUsd multiplies gold by the on-chain rate", () => {
  // rate ~1.000551 (live getRate), gold ~$4264.81 -> ~$4267.16
  const p = paxgyPriceUsd(4264.81, 1000551359560489681n);
  assert.ok(Math.abs(p - 4267.16) < 0.5, `got ${p}`);
});

test("paxgyPriceUsd at par equals gold", () => {
  assert.equal(paxgyPriceUsd(4000, 1000000000000000000n), 4000);
});

test("paxgyPriceUsd rejects an out-of-band rate", () => {
  assert.throws(() => paxgyPriceUsd(4000, 1300000000000000000n)); // 1.3, above cap
  assert.throws(() => paxgyPriceUsd(4000, 900000000000000000n)); // 0.9, below par
});

test("paxgyPriceUsd rejects a non-positive gold price", () => {
  assert.throws(() => paxgyPriceUsd(0, 1000000000000000000n));
});

test("goldMarketStatus: closed over the weekend gold gap, open midweek", () => {
  const REGULAR = 2, CLOSED = 5;
  assert.equal(goldMarketStatus(new Date("2026-09-26T12:00:00Z")), CLOSED); // Saturday
  assert.equal(goldMarketStatus(new Date("2026-09-27T12:00:00Z")), CLOSED); // Sunday midday
  assert.equal(goldMarketStatus(new Date("2026-09-27T23:00:00Z")), REGULAR); // Sunday after 22:00 open
  assert.equal(goldMarketStatus(new Date("2026-09-25T23:00:00Z")), CLOSED); // Friday after 22:00 close
  assert.equal(goldMarketStatus(new Date("2026-09-23T12:00:00Z")), REGULAR); // Wednesday
});
