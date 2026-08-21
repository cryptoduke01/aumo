import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeAttribution } from "../src/proof/attribution.js";

function receipt(
  takenAt: string,
  totalAssets: number,
  totalSupply: number,
  venues: Array<{ address: string; name: string; liveBalance: string; allocatedPrincipal: string }>,
): string {
  return JSON.stringify({
    takenAt,
    snapshot: {
      vault: { totalAssets: String(totalAssets), totalSupply: String(totalSupply), decimals: 6 },
      venues,
    },
  });
}

test("attribution: realized yield is price-per-share growth and beats idle", () => {
  const dir = mkdtempSync(join(tmpdir(), "aumo-attr-"));
  const file = join(dir, "decisions.jsonl");
  const v0 = [
    { address: "0xaa", name: "Aave", liveBalance: "500000000", allocatedPrincipal: "500000000" },
  ];
  const v1 = [
    { address: "0xaa", name: "Aave", liveBalance: "515000000", allocatedPrincipal: "500000000" }, // +15
    { address: "0xbb", name: "Pendle", liveBalance: "205000000", allocatedPrincipal: "200000000" }, // +5
  ];
  writeFileSync(
    file,
    [
      receipt("2026-08-01T00:00:00.000Z", 1_000_000_000, 1_000_000_000, v0), // pps 1.00
      receipt("2026-08-03T00:00:00.000Z", 1_020_000_000, 1_000_000_000, v1), // pps 1.02 (+2%)
    ].join("\n") + "\n",
  );

  const a = computeAttribution(6, file);
  assert.equal(a.samples, 2);
  assert.ok(a.realizedYieldBps !== null && Math.abs(a.realizedYieldBps - 200) < 1, "≈ +200bps");
  assert.equal(a.beatIdle, true);
  assert.ok(a.annualizedBps !== null && a.annualizedBps > a.realizedYieldBps!, "annualized > realized");
  // Per-venue: Aave 15 + Pendle 5 = 20 total; shares 75% / 25%.
  assert.equal(a.perVenue.length, 2);
  assert.equal(a.perVenue[0]!.name, "Aave");
  assert.ok(Math.abs(a.totalAccrued - 20) < 1e-6);
  assert.ok(Math.abs(a.perVenue[0]!.sharePct - 0.75) < 1e-6);
});

test("attribution: no data returns nulls, never throws", () => {
  const a = computeAttribution(6, "/nonexistent/decisions.jsonl");
  assert.equal(a.realizedYieldBps, null);
  assert.equal(a.beatIdle, false);
  assert.equal(a.samples, 0);
  assert.deepEqual(a.perVenue, []);
});
