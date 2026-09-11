import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDeployable, type EquityPoolView } from "../src/equity/executor.ts";

const base: EquityPoolView = {
  allowed: true,
  paused: false,
  marketOpen: true,
  idle: 1_000_000_000n, // 1,000 USD₮0 (6dp)
  exposure: 0n,
  totalDeployed: 0n,
  maxMove: 500_000_000n, // 500
  perVenueCap: 5_000_000_000n, // 5,000
  maxTotal: 5_000_000_000n, // 5,000
};

test("deploys, capped by the per-move size", () => {
  const { deployable } = computeDeployable(base);
  assert.equal(deployable, 500_000_000n, "min(idle 1000, maxMove 500) = 500");
});

test("deploys the full idle when under the per-move cap", () => {
  const { deployable } = computeDeployable({ ...base, idle: 300_000_000n });
  assert.equal(deployable, 300_000_000n);
});

test("holds when the market is closed (the M1 gate)", () => {
  const { deployable, reason } = computeDeployable({ ...base, marketOpen: false });
  assert.equal(deployable, 0n);
  assert.match(reason, /market closed/);
});

test("holds when the pool is paused", () => {
  assert.equal(computeDeployable({ ...base, paused: true }).deployable, 0n);
});

test("holds when the venue is not allowlisted", () => {
  assert.equal(computeDeployable({ ...base, allowed: false }).deployable, 0n);
});

test("holds when there is no idle", () => {
  const { deployable, reason } = computeDeployable({ ...base, idle: 0n });
  assert.equal(deployable, 0n);
  assert.match(reason, /no idle/);
});

test("respects remaining per-venue headroom on the exposure basis", () => {
  // 4,800 already exposed against a 5,000 cap → only 200 headroom, below the 500 per-move cap.
  const { deployable } = computeDeployable({ ...base, exposure: 4_800_000_000n });
  assert.equal(deployable, 200_000_000n);
});

test("respects remaining total headroom", () => {
  const { deployable } = computeDeployable({ ...base, totalDeployed: 4_900_000_000n });
  assert.equal(deployable, 100_000_000n);
});

test("holds when caps leave no headroom", () => {
  const { deployable, reason } = computeDeployable({ ...base, exposure: 5_000_000_000n });
  assert.equal(deployable, 0n);
  assert.match(reason, /no headroom/);
});
