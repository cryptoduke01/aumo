import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/brain/plan.js";
import { snap, venue, M, VENUE_A, VENUE_B } from "./helpers.js";

test("never proposes a single move above maxMoveSize", () => {
  const plan = buildPlan(snap({ idle: 1000n * M, maxMoveSize: 100n * M }), { appetite: "moderate" });
  for (const m of plan.moves.filter((x) => x.action === "allocate")) {
    assert.ok(m.amount <= 100n * M, `move ${m.amount} exceeded maxMoveSize`);
  }
});

test("respects per-venue cap headroom", () => {
  // 450 already in the venue, cap 500 -> at most 50 more, even though maxMove is 100.
  const s = snap({ idle: 1000n * M, totalDeployed: 450n * M, perVenueCap: 500n * M }, [
    venue({ allocatedPrincipal: 450n * M, liveBalance: 450n * M }),
  ]);
  const plan = buildPlan(s, { appetite: "moderate" });
  const alloc = plan.moves.find((m) => m.action === "allocate");
  assert.ok(alloc, "expected an allocate");
  assert.equal(alloc!.amount, 50n * M);
});

test("respects the global maxTotalDeployed cap", () => {
  const s = snap({ idle: 1000n * M, totalDeployed: 950n * M, maxTotalDeployed: 1000n * M }, [
    venue({ allocatedPrincipal: 0n }),
  ]);
  const plan = buildPlan(s, { appetite: "moderate" });
  const added = plan.moves
    .filter((m) => m.action === "allocate")
    .reduce((a, m) => a + m.amount, 0n);
  assert.ok(added <= 50n * M, `added ${added} beyond global headroom`);
});

test("respects the concentration cap", () => {
  // High per-move + per-venue caps so only concentration can bind. maxConc 0.2 of 1000 = 200.
  const s = snap({ idle: 1000n * M, maxMoveSize: 1000n * M, perVenueCap: 1000n * M });
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 0.2 });
  const alloc = plan.moves.find((m) => m.action === "allocate");
  assert.ok(alloc);
  assert.equal(alloc!.amount, 200n * M);
});

test("a defensive regime deploys less than a calm one", () => {
  const s = snap({ idle: 1000n * M, maxMoveSize: 1000n * M, perVenueCap: 1000n * M });
  const calm = buildPlan(s, { appetite: "moderate", regime: "calm", maxConcentration: 1 });
  const def = buildPlan(s, { appetite: "moderate", regime: "defensive", maxConcentration: 1 });
  const sum = (p: typeof calm) =>
    p.moves.filter((m) => m.action === "allocate").reduce((a, m) => a + m.amount, 0n);
  assert.ok(sum(def) < sum(calm));
});

test("retreats from a venue that is no longer allowlisted", () => {
  const s = snap({ totalDeployed: 100n * M }, [
    venue({ allowed: false, allocatedPrincipal: 100n * M, liveBalance: 103n * M }),
  ]);
  const plan = buildPlan(s, { appetite: "moderate" });
  const out = plan.moves.find((m) => m.action === "deallocate");
  assert.ok(out, "expected a retreat");
  assert.equal(out!.venue, VENUE_A);
  assert.equal(out!.amount, 103n * M); // pulls the live balance (principal + yield)
});

test("retreats when the venue risk band exceeds appetite", () => {
  const risky = venue({
    protocolRisk: 0.9,
    liquidityUsd: 10_000,
    pegDeviationBps: 300,
    allocatedPrincipal: 100n * M,
    liveBalance: 100n * M,
  });
  const s = snap({ totalDeployed: 100n * M }, [risky]);
  const plan = buildPlan(s, { appetite: "low" });
  assert.ok(plan.moves.some((m) => m.action === "deallocate"));
  assert.ok(!plan.moves.some((m) => m.action === "allocate"));
});

test("a vetoed venue is excluded from new deploys", () => {
  const s = snap();
  const withVeto = buildPlan(s, { appetite: "moderate", deny: new Set([VENUE_A.toLowerCase()]) });
  assert.ok(!withVeto.moves.some((m) => m.action === "allocate"));
});

test("rotates from the lowest-yield held venue into the best eligible venue when the edge clears the floor", () => {
  // Fully deployed (idle 0), so idle-deploy is a no-op and only a rotation can improve the position.
  const s = snap({ idle: 0n, totalDeployed: 100n * M, maxMoveSize: 100n * M, perVenueCap: 500n * M }, [
    venue({ address: VENUE_A, name: "Low", apyBps: 30, allocatedPrincipal: 100n * M, liveBalance: 100n * M, liquidityUsd: 500_000 }),
    venue({ address: VENUE_B, name: "High", apyBps: 800, allocatedPrincipal: 0n, liveBalance: 0n, liquidityUsd: 5_000_000 }),
  ]);
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 1 });
  const out = plan.moves.find((m) => m.rebalance && m.action === "deallocate");
  const into = plan.moves.find((m) => m.rebalance && m.action === "allocate");
  assert.ok(out && into, "expected a rotation pair");
  assert.equal(out!.venue, VENUE_A, "rotate out of the low-yield venue");
  assert.equal(into!.venue, VENUE_B, "rotate into the high-yield venue");
  assert.equal(out!.amount, 100n * M);
  assert.equal(into!.amount, 100n * M);
  assert.match(plan.summary, /rotation/);
});

test("does not rotate when the yield edge is below the rotation floor", () => {
  // 3.0% vs 3.8% — a real but sub-2% risk-adjusted edge; not worth the round-trip cost.
  const s = snap({ idle: 0n, totalDeployed: 100n * M }, [
    venue({ address: VENUE_A, name: "A", apyBps: 300, allocatedPrincipal: 100n * M, liveBalance: 100n * M, liquidityUsd: 500_000 }),
    venue({ address: VENUE_B, name: "B", apyBps: 380, allocatedPrincipal: 0n, liveBalance: 0n, liquidityUsd: 5_000_000 }),
  ]);
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 1 });
  assert.ok(!plan.moves.some((m) => m.rebalance), "no rotation on a sub-floor edge");
});

test("a rotation is bounded by the target's per-venue cap", () => {
  // Target already holds 480 of a 500 cap → only 20 of headroom, even though the source holds 100.
  const s = snap(
    { idle: 0n, totalDeployed: 580n * M, maxMoveSize: 100n * M, perVenueCap: 500n * M, maxTotalDeployed: 1000n * M },
    [
      venue({ address: VENUE_A, name: "Low", apyBps: 30, allocatedPrincipal: 100n * M, liveBalance: 100n * M, liquidityUsd: 500_000 }),
      venue({ address: VENUE_B, name: "High", apyBps: 800, allocatedPrincipal: 480n * M, liveBalance: 480n * M, liquidityUsd: 5_000_000 }),
    ],
  );
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 1 });
  const into = plan.moves.find((m) => m.rebalance && m.action === "allocate");
  assert.ok(into, "expected a rotation into the target");
  assert.equal(into!.amount, 20n * M, "capped at 500 - 480 = 20 of per-venue headroom");
});

test("global invariant: every allocate satisfies all caps together", () => {
  const s = snap({ idle: 5000n * M, totalDeployed: 100n * M }, [
    venue({ address: VENUE_A, allocatedPrincipal: 100n * M, liveBalance: 100n * M }),
  ]);
  const plan = buildPlan(s, { appetite: "moderate", maxConcentration: 0.6 });
  let added = 0n;
  for (const m of plan.moves.filter((x) => x.action === "allocate")) {
    assert.ok(m.amount <= s.vault.maxMoveSize);
    assert.ok(m.amount + 100n * M <= s.vault.perVenueCap);
    added += m.amount;
  }
  assert.ok(s.vault.totalDeployed + added <= s.vault.maxTotalDeployed);
});
