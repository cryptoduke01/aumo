import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRebalance, type BasketView } from "../src/equity/basket.ts";

const V = (balance: bigint, symbol: string) => ({ symbol, venue: `0x${symbol}` as `0x${string}`, balance });

const base: BasketView = {
  nav: 4_000_000_000n, // 4,000 USD₮0 (6dp)
  idle: 4_000_000_000n, // all idle, nothing deployed yet
  marketOpen: true,
  paused: false,
  totalDeployed: 0n,
  maxMove: 1_000_000_000n, // 1,000 per move
  perVenueCap: 20_000_000_000n,
  maxTotal: 50_000_000_000n,
  bandBps: 500, // 5%
  venues: [V(0n, "NVDA"), V(0n, "AAPL"), V(0n, "MSFT"), V(0n, "META")],
};

test("fresh basket: buys an under-weight venue, capped by maxMove", () => {
  const m = computeRebalance(base);
  assert.equal(m.action, "allocate");
  assert.equal(m.amount, 1_000_000_000n, "min(target 1000, maxMove 1000) = 1000");
  assert.equal(m.targetEach, 1_000_000_000n, "target = NAV/4");
});

test("balanced basket: holds", () => {
  const bal = 1_000_000_000n;
  const m = computeRebalance({
    ...base,
    idle: 0n,
    totalDeployed: 4_000_000_000n,
    venues: [V(bal, "NVDA"), V(bal, "AAPL"), V(bal, "MSFT"), V(bal, "META")],
  });
  assert.equal(m.action, "hold");
});

test("over-weight with no idle: trims the most over-weight venue to free idle", () => {
  const m = computeRebalance({
    ...base,
    idle: 0n,
    totalDeployed: 4_000_000_000n,
    venues: [V(1_600_000_000n, "NVDA"), V(800_000_000n, "AAPL"), V(800_000_000n, "MSFT"), V(800_000_000n, "META")],
  });
  assert.equal(m.action, "deallocate");
  assert.equal(m.symbol, "NVDA");
  assert.equal(m.amount, 600_000_000n, "trim 1600 back to 1000 target");
});

test("under-weight buy is preferred over a trim when idle is available", () => {
  const m = computeRebalance({
    ...base,
    idle: 400_000_000n,
    totalDeployed: 3_600_000_000n,
    venues: [V(1_600_000_000n, "NVDA"), V(1_000_000_000n, "AAPL"), V(1_000_000_000n, "MSFT"), V(0n, "META")],
  });
  assert.equal(m.action, "allocate");
  assert.equal(m.symbol, "META", "buy the empty venue with the available idle");
  assert.equal(m.amount, 400_000_000n, "capped by idle");
});

test("market closed: holds", () => {
  assert.equal(computeRebalance({ ...base, marketOpen: false }).action, "hold");
});

test("paused: holds", () => {
  assert.equal(computeRebalance({ ...base, paused: true }).action, "hold");
});
