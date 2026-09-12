import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/brain/plan.js";
import { snap, venue, M, VENUE_A, VENUE_B } from "./helpers.js";
import type { Address } from "../src/types.js";

const USDG: Address = "0x00000000000000000000000000000000000000d6";
const USDT0: Address = "0x00000000000000000000000000000000000000e7";

// The pool promises on-demand redemption, so fixed-term venues (Pendle PT — not redeemable at face
// before maturity) are capped to MAX_TERM_CONCENTRATION (25%) of the pool. These lock that behaviour
// so the "60% in Pendle, can't withdraw" situation can never recur.

test("term cap: trims fixed-term exposure held above the 25% cap", () => {
  // Pool = 1000. Pendle (term) holds 500 = 50%, over the 25% cap (250). Trim the 250 excess from it.
  // Underlying USDG = 500 = 50% < 80% so the underlying cap does NOT bind; only the term cap does.
  const s = snap(
    { idle: 250n * M, totalDeployed: 750n * M, totalAssets: 1000n * M, maxMoveSize: 1000n * M, perVenueCap: 1000n * M },
    [
      venue({ address: VENUE_A, name: "Pendle PT-USDG", kind: "rwa", term: true, underlying: USDG, apyBps: 320, allocatedPrincipal: 500n * M, liveBalance: 500n * M }),
      venue({ address: VENUE_B, name: "Aave", kind: "lending", underlying: USDT0, apyBps: 300, allocatedPrincipal: 250n * M, liveBalance: 250n * M }),
    ],
  );
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 1 });
  const trim = plan.moves.find((m) => m.reasonTag === "diversify:term");
  assert.ok(trim, "expected a fixed-term trim");
  assert.equal(trim!.action, "deallocate");
  assert.equal(trim!.venue, VENUE_A);
  assert.equal(trim!.amount, 250n * M); // exactly the excess (500 - 250)
  assert.match(trim!.rationale, /fixed-term/);
});

test("term cap: new idle cannot push a fixed-term venue past the cap", () => {
  // Pool = 400. Pendle (term) sits exactly at the 25% cap (100). Even though it has the best APY, the
  // idle must route to the liquid venue instead of adding more to the fixed-term one.
  const s = snap(
    { idle: 200n * M, totalDeployed: 200n * M, totalAssets: 400n * M, maxMoveSize: 1000n * M, perVenueCap: 1000n * M },
    [
      venue({ address: VENUE_A, name: "Pendle", kind: "rwa", term: true, underlying: USDG, apyBps: 500, allocatedPrincipal: 100n * M, liveBalance: 100n * M }),
      venue({ address: VENUE_B, name: "Aave", kind: "lending", underlying: USDT0, apyBps: 100, allocatedPrincipal: 100n * M, liveBalance: 100n * M }),
    ],
  );
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 1 });
  assert.equal(
    plan.moves.find((m) => m.action === "allocate" && m.venue === VENUE_A),
    undefined,
    "no new allocation into a fixed-term venue already at the cap",
  );
});

test("term cap: silent when fixed-term exposure is under the cap", () => {
  // Pendle (term) at 100 of a 1000 pool = 10% < 25%: no trim.
  const s = snap(
    { idle: 100n * M, totalDeployed: 900n * M, totalAssets: 1000n * M, maxMoveSize: 1000n * M, perVenueCap: 1000n * M },
    [
      venue({ address: VENUE_A, name: "Pendle", kind: "rwa", term: true, underlying: USDG, apyBps: 320, allocatedPrincipal: 100n * M, liveBalance: 100n * M }),
      venue({ address: VENUE_B, name: "Aave", kind: "lending", underlying: USDT0, apyBps: 300, allocatedPrincipal: 800n * M, liveBalance: 800n * M }),
    ],
  );
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 1 });
  assert.equal(plan.moves.find((m) => m.reasonTag === "diversify:term"), undefined);
});
