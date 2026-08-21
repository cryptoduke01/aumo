import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseAbi } from "viem";
import type { PublicClient, Address } from "viem";
import { RECEIPTS_DIR } from "../act/receipts.js";

/**
 * Live fee-APY feed for a full-range Uniswap v3 LP venue. Uniswap has no historical fee oracle, so the
 * only honest way to know the pool's realized fee yield is to measure the growth of feeGrowthGlobal
 * between two readings over time. We persist the last reading (alongside the receipts) and, once a
 * smoothing window has elapsed, annualize the delta into an APY. This replaces the static placeholder
 * with a number that is actually earned on-chain; on a cold start (no prior reading yet) it returns the
 * configured fallback until a full window accrues.
 */

const poolAbi = parseAbi([
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const YEAR = 365n * 24n * 60n * 60n;
// For a FULL-RANGE position both legs are always in range, so the fee yield over a period is
// (Δfg0 + Δfg1) / 2^129: feeGrowthGlobal is fees-per-unit-liquidity scaled by 2^128, and a full-range
// position's value is ~2 per unit liquidity at the peg, so the liquidity and decimal scales cancel.
const Q129 = 1n << 129n;
const MIN_PERIOD_SEC = 3600; // recompute at most hourly, to smooth short-cycle noise
const MAX_APY_BPS = 5000; // a stable/stable full-range LP paying >50% is a bad reading, not real yield

/** Pure, testable: annualize a summed feeGrowth delta over `periodSec` into bps. Clamped and safe. */
export function lpApyBps(feeGrowthDelta: bigint, periodSec: number): number {
  if (feeGrowthDelta <= 0n || periodSec <= 0) return 0;
  const bps = Number((feeGrowthDelta * YEAR * 10_000n) / (Q129 * BigInt(periodSec)));
  return Math.max(0, Math.min(MAX_APY_BPS, bps));
}

export interface LpMarket {
  apyBps: number;
  tvlUsd: number;
  liquidityUsd: number;
  utilization: number;
}

interface LpState {
  fg0: string;
  fg1: string;
  ts: number;
  apyBps: number;
}

const statePathFor = (pool: Address): string =>
  join(RECEIPTS_DIR, `lpfeed-${pool.toLowerCase()}.json`);

const writeState = (path: string, s: LpState): void => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(s));
  } catch {
    /* best-effort cache; on an ephemeral FS the feed simply keeps using the fallback */
  }
};

/**
 * Read the pool's live fee APY (from the feeGrowth delta since the last reading) plus its real reserves
 * as TVL/liquidity. `fallbackApyBps` is used only until a full smoothing window has elapsed. Both legs
 * are dollar-pegged 6dp, valued 1:1.
 */
export async function readUniV3LpMarket(
  pc: PublicClient,
  pool: Address,
  fallbackApyBps: number,
): Promise<LpMarket> {
  const [fg0, fg1, t0, t1] = await Promise.all([
    pc.readContract({ address: pool, abi: poolAbi, functionName: "feeGrowthGlobal0X128" }),
    pc.readContract({ address: pool, abi: poolAbi, functionName: "feeGrowthGlobal1X128" }),
    pc.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
    pc.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
  ]);
  const [bal0, bal1, dec0] = await Promise.all([
    pc.readContract({ address: t0, abi: erc20, functionName: "balanceOf", args: [pool] }),
    pc.readContract({ address: t1, abi: erc20, functionName: "balanceOf", args: [pool] }),
    pc.readContract({ address: t0, abi: erc20, functionName: "decimals" }),
  ]);
  const unit = 10 ** Number(dec0);
  const tvlUsd = (Number(bal0) + Number(bal1)) / unit; // both legs ~$1

  const block = await pc.getBlock();
  const now = Number(block.timestamp);

  const path = statePathFor(pool);
  let prev: LpState | null = null;
  try {
    if (existsSync(path)) prev = JSON.parse(readFileSync(path, "utf8")) as LpState;
  } catch {
    prev = null;
  }

  let apyBps: number;
  if (prev && now - prev.ts >= MIN_PERIOD_SEC) {
    const delta = BigInt(fg0) - BigInt(prev.fg0) + (BigInt(fg1) - BigInt(prev.fg1));
    apyBps = lpApyBps(delta, now - prev.ts); // 0 if no fees accrued over the window — honest, not stale
    writeState(path, { fg0: fg0.toString(), fg1: fg1.toString(), ts: now, apyBps });
  } else if (prev) {
    apyBps = prev.apyBps; // inside the smoothing window: reuse the last computed rate
  } else {
    apyBps = fallbackApyBps; // cold start: seed the window, use the fallback until one elapses
    writeState(path, { fg0: fg0.toString(), fg1: fg1.toString(), ts: now, apyBps });
  }

  return { apyBps, tvlUsd, liquidityUsd: tvlUsd, utilization: 0 };
}
