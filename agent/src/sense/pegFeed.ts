import { parseAbi, type PublicClient } from "viem";
import type { PegSource } from "../types.js";

/**
 * Live peg source for a stable / RWA yield asset (F-2). Reads the Uniswap v3 pool that quotes the
 * asset against the vault's numeraire (USDT0) and returns how far it trades from $1, in basis
 * points. It prefers a manipulation-resistant TWAP and only marks the reading `verified` when a
 * TWAP is available; a spot-only read (thin observation history) still MEASURES a visible depeg but
 * is not trusted to CERTIFY a healthy peg, so the risk engine keeps flooring peg risk until a TWAP
 * can confirm it. Every failure path is conservative: the caller treats any error as unverified.
 *
 * Why this matters: without it, `pegDeviationBps` is a static 0 on mainnet, the 20% peg weight
 * contributes nothing, and the agent would keep funding a de-pegging RWA venue at full score.
 */

const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)",
  "function observe(uint32[]) view returns (int56[], uint160[])",
]);

export interface PegReading {
  pegDeviationBps: number; // |price - 1| in bps, >= 0, integer
  verified: boolean; // true only when derived from a TWAP (manipulation-resistant)
  source: "twap" | "spot";
}

/**
 * Deviation from $1 (bps) for a Uniswap v3 tick. `price(token0 in token1) = 1.0001^tick`; we want
 * the yield asset priced in the numeraire, so if the yield asset is token0 that IS `1.0001^tick`,
 * otherwise we invert. USDT0 and USDG are both 6dp, so no decimal scaling is needed. Computed
 * exactly (not the tick≈bps small-angle shortcut) so a large, real depeg is measured correctly.
 */
export function tickToDeviationBps(tick: number, yieldIsToken0: boolean): number {
  let price = Math.pow(1.0001, tick);
  if (!yieldIsToken0) price = 1 / price;
  if (!Number.isFinite(price) || price <= 0) return 10_000; // pathological → treat as fully off peg
  return Math.max(0, Math.round(Math.abs(price - 1) * 10_000));
}

export async function readPeg(pc: PublicClient, spec: PegSource): Promise<PegReading> {
  if (!(spec.twapWindowSec > 0)) throw new Error("pegFeed: twapWindowSec must be > 0");

  const token0 = await pc.readContract({ address: spec.pool, abi: poolAbi, functionName: "token0" });
  const yieldIsToken0 = token0.toLowerCase() === spec.yieldToken.toLowerCase();

  // Prefer the TWAP. observe() reverts ("OLD") when the pool's observation history can't cover the
  // window (e.g. cardinality 1 plus a very recent swap); fall back to spot and stay unverified.
  try {
    const [tickCumulatives] = await pc.readContract({
      address: spec.pool,
      abi: poolAbi,
      functionName: "observe",
      args: [[spec.twapWindowSec, 0]],
    });
    // secondsAgos = [window, 0] → index 0 is (now - window), index 1 is now.
    const past = tickCumulatives[0];
    const now = tickCumulatives[1];
    if (past === undefined || now === undefined) throw new Error("pegFeed: short observe result");
    const avgTick = Number(now - past) / spec.twapWindowSec;
    return { pegDeviationBps: tickToDeviationBps(avgTick, yieldIsToken0), verified: true, source: "twap" };
  } catch {
    const slot0 = await pc.readContract({ address: spec.pool, abi: poolAbi, functionName: "slot0" });
    const tick = Number(slot0[1]); // int24 current tick
    return { pegDeviationBps: tickToDeviationBps(tick, yieldIsToken0), verified: false, source: "spot" };
  }
}
