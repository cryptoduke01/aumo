import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import { tickToDeviationBps, readPeg } from "../src/sense/pegFeed.js";
import { scoreVenue } from "../src/risk/engine.js";
import { policyFingerprint } from "../src/identity.js";
import type { Address, PegSource } from "../src/types.js";
import type { Config } from "../src/config.js";
import { venue, snap } from "./helpers.js";

const YIELD = "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8" as Address; // USDG
const NUMERAIRE = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as Address; // USDT0
const POOL = "0x0cbe0dbe1400e57f371a38bd3b9bc80f7c3676da" as Address;

const spec: PegSource = { kind: "univ3Twap", pool: POOL, yieldToken: YIELD, twapWindowSec: 300 };

// A minimal PublicClient stub: only readContract is exercised by readPeg.
function mockPc(handler: (fn: string, args?: unknown[]) => unknown): PublicClient {
  return {
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) =>
      handler(functionName, args),
  } as unknown as PublicClient;
}

test("tickToDeviationBps: tick ≈ bps for a near-perfect peg, exact for a real depeg", () => {
  assert.equal(tickToDeviationBps(0, true), 0);
  assert.equal(tickToDeviationBps(10, true), 10); // USDG ~$1.001
  assert.equal(tickToDeviationBps(-50, true), 50); // USDG ~$0.995
  assert.equal(tickToDeviationBps(10, false), 10); // inverted quoting is symmetric in magnitude
  assert.equal(tickToDeviationBps(-500, true), 488); // ~5% depeg measured exactly, not ~500
});

test("readPeg prefers the TWAP and marks it verified", async () => {
  // secondsAgos [300, 0] → cumulatives [0, 3000] ⇒ avg tick 10 over 300s.
  const pc = mockPc((fn) => {
    if (fn === "token0") return YIELD;
    if (fn === "observe") return [[0n, 3000n], [0n, 0n]];
    throw new Error(`unexpected ${fn}`);
  });
  const r = await readPeg(pc, spec);
  assert.equal(r.source, "twap");
  assert.equal(r.verified, true);
  assert.equal(r.pegDeviationBps, 10);
});

test("readPeg falls back to spot (unverified) when observe reverts", async () => {
  const pc = mockPc((fn) => {
    if (fn === "token0") return YIELD;
    if (fn === "observe") throw new Error("OLD");
    if (fn === "slot0") return [0n, -50, 0, 1, 1, 0, true]; // current tick -50
    throw new Error(`unexpected ${fn}`);
  });
  const r = await readPeg(pc, spec);
  assert.equal(r.source, "spot");
  assert.equal(r.verified, false);
  assert.equal(r.pegDeviationBps, 50);
});

test("readPeg inverts correctly when the yield asset is token1", async () => {
  const pc = mockPc((fn) => {
    if (fn === "token0") return NUMERAIRE; // yield asset is token1 → invert
    if (fn === "observe") return [[0n, 3000n], [0n, 0n]];
    throw new Error(`unexpected ${fn}`);
  });
  const r = await readPeg(pc, spec);
  assert.equal(r.pegDeviationBps, 10);
});

test("engine: a verified live peg is trusted; an unverified RWA peg is floored (F-2)", () => {
  const clean = { kind: "rwa" as const, protocolRisk: 0, tvlUsd: 1_000_000, liquidityUsd: 1_000_000 };
  const verified = scoreVenue(venue({ ...clean, pegDeviationBps: 10, pegVerified: true }), 6, 1000);
  const unverified = scoreVenue(venue({ ...clean, pegDeviationBps: 10, pegVerified: false }), 6, 1000);
  assert.ok(verified.pegRisk < 0.1, "a measured healthy peg scores low");
  assert.ok(unverified.pegRisk >= 0.5, "an unverified RWA peg is floored");
  assert.ok(unverified.riskScore > verified.riskScore);
  assert.ok(unverified.notes.some((n) => n.includes("peg unverified")));
});

test("engine: a real depeg dominates even on an unverified (spot) reading", () => {
  const depeg = scoreVenue(venue({ kind: "rwa", pegDeviationBps: 400, pegVerified: false }), 6, 1000);
  assert.equal(depeg.pegRisk, 1); // 400/150 clamps to 1, well above the 0.5 floor
});

const cfg = { chainId: 196, appetite: "cautious", maxConcentration: 0.6 } as unknown as Config;

test("fingerprint changes when the loss/deploy budget changes (F-4)", () => {
  const a = snap({ maxEpochLoss: 100n, lossEpochLength: 86400n, maxEpochDeploy: 200n, deployEpochLength: 86400n });
  const b = snap({ maxEpochLoss: 999n, lossEpochLength: 86400n, maxEpochDeploy: 200n, deployEpochLength: 86400n });
  assert.notEqual(policyFingerprint(a, cfg), policyFingerprint(b, cfg));
});

test("fingerprint changes when the venue allowlist changes (F-4)", () => {
  const allowed = snap({}, [venue({ allowed: true })]);
  const excluded = snap({}, [venue({ allowed: false })]);
  assert.notEqual(policyFingerprint(allowed, cfg), policyFingerprint(excluded, cfg));
});

test("fingerprint is stable across pools that never expose a budget (null ≡ null)", () => {
  const one = snap({}); // no budget fields set
  const two = snap({}); // identical
  assert.equal(policyFingerprint(one, cfg), policyFingerprint(two, cfg));
});
