import { test } from "node:test";
import assert from "node:assert/strict";
import { critique } from "../src/brain/critic.js";
import type { Plan } from "../src/brain/plan.js";
import type { VenueRisk } from "../src/risk/engine.js";
import { snap, venue, VENUE_A, M } from "./helpers.js";

function risk(over: Partial<VenueRisk> = {}): VenueRisk {
  return {
    address: VENUE_A,
    name: "V",
    apyBps: 800,
    protocolRisk: 0.1,
    liquidityRisk: 0.1,
    pegRisk: 0,
    utilizationRisk: 0,
    concentrationRisk: 0.1,
    momentumRisk: 0,
    correlatedExposure: 0.1,
    riskScore: 0.15,
    band: "low",
    riskAdjustedApyBps: 700,
    notes: [],
    ...over,
  };
}

function planWith(moves: Plan["moves"], risks: VenueRisk[]): Plan {
  return {
    regime: "calm",
    appetite: "moderate",
    moves,
    idleBefore: 0n,
    idleAfter: 0n,
    totalDeployedAfter: 0n,
    risks,
    summary: "base",
    source: "risk-engine",
  };
}

const alloc = (amount: bigint) => ({
  venue: VENUE_A,
  venueName: "V",
  action: "allocate" as const,
  amount,
  reasonTag: "",
  rationale: "",
  band: "low" as const,
  riskScore: 0.15,
  riskAdjustedApyBps: 700,
});

test("critic vetoes adding to a venue that is actively deteriorating", () => {
  const s = snap({}, [venue({ liquidityUsd: 5_000_000 })]);
  const out = critique(s, planWith([alloc(100n * M)], [risk({ momentumRisk: 0.6 })]));
  assert.ok(out.critic?.vetoes.includes(VENUE_A.toLowerCase()));
  assert.equal(out.moves.filter((m) => m.action === "allocate").length, 0, "allocation removed");
});

test("critic vetoes taking too large a share of a venue's exit liquidity", () => {
  // liquidity $700; allocating 400 USDT0 ($400) is 57% > the 25% cap.
  const s = snap({ perVenueCap: 1000n * M, maxMoveSize: 1000n * M }, [venue({ liquidityUsd: 700 })]);
  const out = critique(s, planWith([alloc(400n * M)], [risk()]));
  assert.ok(out.critic?.vetoes.includes(VENUE_A.toLowerCase()));
});

test("critic holds (doubt) when the plan would leave too little idle buffer", () => {
  // idle 1000, deploy ~980 into a deep venue → idle buffer ~2% < 5% floor → hold.
  const s = snap({ perVenueCap: 100000n * M, maxMoveSize: 100000n * M, maxTotalDeployed: 100000n * M }, [
    venue({ liquidityUsd: 50_000_000 }),
  ]);
  const out = critique(s, planWith([alloc(980n * M)], [risk()]));
  assert.equal(out.critic?.doubt, true);
  assert.equal(out.moves.filter((m) => m.action === "allocate").length, 0, "held: allocation dropped");
});

test("critic passes a clean, well-sized plan unchanged", () => {
  const s = snap({}, [venue({ liquidityUsd: 5_000_000 })]);
  const out = critique(s, planWith([alloc(50n * M)], [risk()]));
  assert.equal(out.critic?.approved, true);
  assert.equal(out.critic?.vetoes.length, 0);
  assert.equal(out.moves.length, 1);
});
