import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreVenue, scorePortfolio, bandOf, BAND_RANK } from "../src/risk/engine.js";
import { venue, VENUE_A, VENUE_B } from "./helpers.js";

test("band thresholds map score to band", () => {
  assert.equal(bandOf(0.0), "low");
  assert.equal(bandOf(0.24), "low");
  assert.equal(bandOf(0.25), "moderate");
  assert.equal(bandOf(0.49), "moderate");
  assert.equal(bandOf(0.5), "elevated");
  assert.equal(bandOf(0.74), "elevated");
  assert.equal(bandOf(0.75), "high");
  assert.equal(bandOf(1.0), "high");
});

test("risk-adjusted APY is the APY haircut by risk score", () => {
  const r = scoreVenue(venue({ apyBps: 800 }), 6, 1000);
  assert.equal(r.riskAdjustedApyBps, Math.round(800 * (1 - r.riskScore)));
  assert.ok(r.riskAdjustedApyBps <= 800);
});

test("higher protocol risk strictly raises the score", () => {
  const lo = scoreVenue(venue({ protocolRisk: 0.05 }), 6, 1000);
  const hi = scoreVenue(venue({ protocolRisk: 0.9 }), 6, 1000);
  assert.ok(hi.riskScore > lo.riskScore);
  assert.ok(BAND_RANK[hi.band] >= BAND_RANK[lo.band]);
});

test("thinner exit liquidity raises the score and is flagged", () => {
  const deep = scoreVenue(venue({ tvlUsd: 1_000_000, liquidityUsd: 800_000 }), 6, 1000);
  const thin = scoreVenue(venue({ tvlUsd: 1_000_000, liquidityUsd: 50_000 }), 6, 1000);
  assert.ok(thin.riskScore > deep.riskScore);
  assert.ok(thin.notes.some((n) => n.includes("thin venue liquidity")));
});

test("liquidity risk rises when our position is large vs withdrawable liquidity", () => {
  // Same venue depth; only OUR position size differs.
  const small = scoreVenue(
    venue({ tvlUsd: 1_000_000, liquidityUsd: 200_000, allocatedPrincipal: 1_000_000n }), // 1 USDT0
    6,
    1_000_000,
  );
  const large = scoreVenue(
    venue({ tvlUsd: 1_000_000, liquidityUsd: 200_000, allocatedPrincipal: 300_000_000_000n }), // 300k > 200k liq
    6,
    1_000_000,
  );
  assert.ok(large.liquidityRisk > small.liquidityRisk);
  assert.ok(large.notes.some((n) => n.includes("large vs withdrawable")));
});

test("concentration is correlation-aware: correlated venues do not diversify", () => {
  const portfolio = 2_000_000; // units
  const half = 1_000_000_000_000n; // 1M USDT0 (6dp) in each venue
  const sameKind = scorePortfolio(
    [
      venue({ address: VENUE_A, kind: "lending", allocatedPrincipal: half }),
      venue({ address: VENUE_B, kind: "lending", allocatedPrincipal: half }),
    ],
    6,
    portfolio,
  );
  const crossKind = scorePortfolio(
    [
      venue({ address: VENUE_A, kind: "lending", allocatedPrincipal: half }),
      venue({ address: VENUE_B, kind: "rwa", allocatedPrincipal: half }),
    ],
    6,
    portfolio,
  );
  // A 50/50 split across two lending venues is more concentrated than across lending + RWA.
  assert.ok(sameKind[0]!.correlatedExposure > crossKind[0]!.correlatedExposure);
  assert.ok(sameKind[0]!.concentrationRisk > crossKind[0]!.concentrationRisk);
});

test("peg deviation is bounded and flagged past 50bps", () => {
  const r = scoreVenue(venue({ pegDeviationBps: 400 }), 6, 1000);
  assert.ok(r.pegRisk <= 1);
  assert.equal(r.pegRisk, 1); // 400bps saturates the 200bps ceiling
  assert.ok(r.notes.some((n) => n.includes("off $1")));
});

test("utilization only bites for lending venues", () => {
  const lending = scoreVenue(venue({ kind: "lending", utilization: 0.95 }), 6, 1000);
  const rwa = scoreVenue(venue({ kind: "rwa", utilization: 0.95 }), 6, 1000);
  assert.ok(lending.utilizationRisk > 0);
  assert.equal(rwa.utilizationRisk, 0);
});

test("score stays within [0,1] under extreme inputs", () => {
  const r = scoreVenue(
    venue({ protocolRisk: 5, pegDeviationBps: 99999, utilization: 9, liquidityUsd: 0 }),
    6,
    1000,
  );
  assert.ok(r.riskScore >= 0 && r.riskScore <= 1);
});
