import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/brain/plan.js";
import { snap, venue, M, VENUE_A, VENUE_B } from "./helpers.js";
import type { Address } from "../src/types.js";

const USDG: Address = "0x00000000000000000000000000000000000000d6"; // shared underlying
const USDT0: Address = "0x00000000000000000000000000000000000000e7"; // different underlying
const VENUE_C: Address = "0x0000000000000000000000000000000000000003";

test("diversification: trims a single underlying held above the cap", () => {
  // Pool = 1000 (idle 50 + deployed 950). USDG underlying holds 600 (V_A) + 350 (V_B) = 950 = 95%,
  // over the 80% single-underlying cap (800). The 150 excess is trimmed from the group's LOWEST
  // risk-adjusted venue. Per-move/per-venue caps raised so only the underlying cap binds.
  const s = snap(
    {
      idle: 50n * M,
      totalDeployed: 950n * M,
      totalAssets: 1000n * M,
      maxMoveSize: 1000n * M,
      perVenueCap: 1000n * M,
    },
    [
      venue({ address: VENUE_A, name: "USDG", kind: "rwa", underlying: USDG, apyBps: 100, allocatedPrincipal: 600n * M, liveBalance: 600n * M }),
      venue({ address: VENUE_B, name: "Pendle PT-USDG", kind: "rwa", underlying: USDG, apyBps: 320, allocatedPrincipal: 350n * M, liveBalance: 350n * M }),
      venue({ address: VENUE_C, name: "Aave", kind: "lending", underlying: USDT0, apyBps: 60, allocatedPrincipal: 0n, liveBalance: 0n }),
    ],
  );
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 1 });
  const trim = plan.moves.find((m) => m.reasonTag === "diversify:underlying");
  assert.ok(trim, "expected a diversification trim");
  assert.equal(trim!.action, "deallocate");
  assert.equal(trim!.venue, VENUE_A); // lowest risk-adjusted USDG venue (apy 100 < 320)
  assert.equal(trim!.amount, 150n * M); // exactly the excess (950 - 800)
  assert.match(trim!.rationale, /single-underlying cap/);
});

test("diversification: silent when the same holdings are untagged (no shared underlying)", () => {
  const s = snap(
    {
      idle: 50n * M,
      totalDeployed: 950n * M,
      totalAssets: 1000n * M,
      maxMoveSize: 1000n * M,
      perVenueCap: 1000n * M,
    },
    [
      venue({ address: VENUE_A, name: "A", apyBps: 100, allocatedPrincipal: 600n * M, liveBalance: 600n * M }),
      venue({ address: VENUE_B, name: "B", apyBps: 320, allocatedPrincipal: 350n * M, liveBalance: 350n * M }),
    ],
  );
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 1 });
  assert.equal(plan.moves.find((m) => m.reasonTag === "diversify:underlying"), undefined);
});

test("diversification: new idle cannot flow into an underlying already at the cap", () => {
  // Pool = 500 (idle 100 + deployed 400). USDG holds 400 = exactly the 80% cap. Per-venue/conc caps
  // leave room, but the underlying headroom is 0, so the idle must route to the other underlying.
  const s = snap(
    {
      idle: 100n * M,
      totalDeployed: 400n * M,
      totalAssets: 500n * M,
      maxMoveSize: 1000n * M,
      perVenueCap: 1000n * M,
      maxTotalDeployed: 2000n * M,
    },
    [
      venue({ address: VENUE_A, name: "USDG", kind: "rwa", underlying: USDG, apyBps: 300, allocatedPrincipal: 400n * M, liveBalance: 400n * M }),
      venue({ address: VENUE_C, name: "Aave", kind: "lending", underlying: USDT0, apyBps: 60, allocatedPrincipal: 0n, liveBalance: 0n }),
    ],
  );
  const plan = buildPlan(s, { appetite: "moderate", regime: "calm", maxConcentration: 1 });
  assert.equal(
    plan.moves.find((m) => m.action === "allocate" && m.venue === VENUE_A),
    undefined,
    "must not add to an underlying already at the cap",
  );
  assert.ok(
    plan.moves.some((m) => m.action === "allocate" && m.venue === VENUE_C),
    "idle should route to the under-cap underlying instead",
  );
});
