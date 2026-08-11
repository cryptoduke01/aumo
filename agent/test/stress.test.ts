import { test } from "node:test";
import assert from "node:assert/strict";
import { stressTest } from "../src/risk/stress.js";
import type { Plan } from "../src/brain/plan.js";
import { snap, venue, VENUE_A, M } from "./helpers.js";

// Minimal Plan carrying only what stressTest reads (the moves it would execute).
function planWith(moves: Plan["moves"]): Plan {
  return {
    regime: "calm",
    appetite: "moderate",
    moves,
    idleBefore: 0n,
    idleAfter: 0n,
    totalDeployedAfter: 0n,
    risks: [],
    summary: "",
    source: "risk-engine",
  };
}

const allocate = (amount: bigint) => [
  {
    venue: VENUE_A,
    venueName: "V",
    action: "allocate" as const,
    amount,
    reasonTag: "",
    rationale: "",
    band: "low" as const,
    riskScore: 0,
    riskAdjustedApyBps: 0,
  },
];

test("stress: a healthy, well-covered position is not fragile", () => {
  const s = snap({}, [venue({ liquidityUsd: 500_000, tvlUsd: 1_000_000, utilization: 0.4 })]);
  const report = stressTest(s, planWith(allocate(50n * M)), "moderate");
  assert.equal(report.fragility, 0);
  assert.equal(report.fragile.length, 0);
  assert.equal(report.recommendedRegime, "calm");
});

test("stress: a position that a liquidity crunch would strand is flagged fragile", () => {
  // Normally exitable (400 position vs 700 liquidity), but a -50% liquidity shock takes withdrawable
  // liquidity to 350 < 400 — we could not get out in one move, so the venue is denied new deploys.
  const s = snap({ perVenueCap: 1000n * M, maxMoveSize: 1000n * M }, [
    venue({ liquidityUsd: 700, tvlUsd: 1_000_000, utilization: 0.4 }),
  ]);
  const report = stressTest(s, planWith(allocate(400n * M)), "moderate");
  assert.ok(report.fragile.includes(VENUE_A.toLowerCase()), "venue flagged fragile");
  assert.ok(report.fragility > 0);
  assert.ok(report.notes.some((n) => n.includes("fragile under stress")));
});

test("stress: broad fragility pulls the recommended regime below calm", () => {
  const s = snap({ perVenueCap: 1000n * M, maxMoveSize: 1000n * M }, [
    venue({ liquidityUsd: 500, tvlUsd: 1_000_000, utilization: 0.9 }),
  ]);
  const report = stressTest(s, planWith(allocate(600n * M)), "moderate");
  assert.notEqual(report.recommendedRegime, "calm");
});
