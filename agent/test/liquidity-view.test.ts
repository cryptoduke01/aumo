import { test } from "node:test";
import assert from "node:assert/strict";
import { liquidityView } from "../src/brain/panel.js";
import { snap, venue, VENUE_A, VENUE_B, M } from "./helpers.js";

// The liquidity panelist judges exit risk SIZE-RELATIVE: our position (or the whole pool, worst
// case) against a venue's WITHDRAWABLE liquidity, never against TVL. These lock the numbers the
// prompt reasons over so a thin-depth-but-huge-TVL venue is not misread as an exit trap for a tiny
// pool. The deterministic LIQUIDITY_SHARE_CAP in the critic remains the hard cap regardless.

test("liquidityView: a huge, deep venue is a rounding error for a tiny pool", () => {
  // Pool = 87 (idle 4 + deployed 83). Aave-like venue: $53M TVL, $5.1M withdrawable (10% of TVL),
  // and we hold nothing there yet. depthPctOfTvl looks 'thin' at 10%, but our whole pool is 0.0017%
  // of its withdrawable liquidity — no exit trap.
  const s = snap({ idle: 4n * M, totalDeployed: 83n * M, totalAssets: 87n * M }, [
    venue({ address: VENUE_A, name: "Aave", tvlUsd: 53_000_000, liquidityUsd: 5_100_000, allocatedPrincipal: 0n }),
  ]);
  const view = liquidityView(s);
  assert.equal(view.poolUsd, 87);
  const aave = view.venues[0]!;
  assert.equal(aave.depthPctOfTvl, 10); // the number that used to trigger the over-veto
  assert.equal(aave.ourExitSharePct, 0); // we hold nothing
  assert.ok(aave.worstCaseExitSharePct! < 0.01, "whole pool is a rounding error of withdrawable liquidity");
});

test("liquidityView: a small, shallow venue can genuinely trap a position", () => {
  // Pool = 1000, and a venue with only $2,000 of withdrawable liquidity that we already half-fill.
  const s = snap({ idle: 500n * M, totalDeployed: 500n * M, totalAssets: 1000n * M }, [
    venue({ address: VENUE_B, name: "Shallow", tvlUsd: 4_000, liquidityUsd: 2_000, allocatedPrincipal: 500n * M }),
  ]);
  const view = liquidityView(s);
  const shallow = view.venues[0]!;
  assert.equal(shallow.ourExitSharePct, 25); // 500 / 2000 — already at the danger line
  assert.equal(shallow.worstCaseExitSharePct, 50); // whole 1000 pool would be half the exit depth
});

test("liquidityView: withdrawable liquidity of zero yields null shares, not a divide-by-zero", () => {
  const s = snap({ idle: 100n * M, totalDeployed: 0n, totalAssets: 100n * M }, [
    venue({ address: VENUE_A, name: "Unknown", tvlUsd: 0, liquidityUsd: 0, allocatedPrincipal: 0n }),
  ]);
  const view = liquidityView(s);
  const u = view.venues[0]!;
  assert.equal(u.depthPctOfTvl, 0);
  assert.equal(u.ourExitSharePct, null);
  assert.equal(u.worstCaseExitSharePct, null);
});
