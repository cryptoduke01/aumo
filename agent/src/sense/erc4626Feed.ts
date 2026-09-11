import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseAbi } from "viem";
import type { PublicClient, Address } from "viem";
import { RECEIPTS_DIR } from "../act/receipts.js";

/**
 * Live yield feed for an ERC-4626 savings vault (e.g. Spark Savings USDT / spUSDT). A savings vault's
 * real APY is the growth of its share price (assets per share) over time, so we read
 * `convertToAssets(1e18)` and, once a smoothing window has elapsed since the last reading, annualize
 * the delta. This replaces the static quoted APR with the yield actually accruing on-chain. Decimals
 * cancel in the ratio, so this works for any 4626 vault regardless of asset/share scaling. On a cold
 * start (no prior reading) it returns the configured fallback until one window accrues.
 */

const vaultAbi = parseAbi([
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function asset() view returns (address)",
]);
const erc20 = parseAbi(["function decimals() view returns (uint8)"]);

const YEAR = 365n * 24n * 60n * 60n;
const ONE = 10n ** 18n; // shares probe amount
const MIN_PERIOD_SEC = 3600; // recompute at most hourly, to smooth and to keep bigint precision
const MAX_APY_BPS = 2000; // a savings vault reading >20% is almost certainly a glitch, not real yield

/** Pure, testable: annualize a share-price growth over `periodSec` into bps. Clamped and safe. */
export function erc4626ApyBps(ppsPrev: bigint, ppsNow: bigint, periodSec: number): number {
  if (ppsPrev <= 0n || periodSec <= 0 || ppsNow <= ppsPrev) return 0; // no growth over the window = 0, honest
  // (Δpps / ppsPrev) * (YEAR / periodSec), expressed in bps.
  const bps = Number(((ppsNow - ppsPrev) * YEAR * 10_000n) / (ppsPrev * BigInt(periodSec)));
  return Math.max(0, Math.min(MAX_APY_BPS, bps));
}

export interface Erc4626Market {
  apyBps: number;
  tvlUsd: number;
  liquidityUsd: number;
  utilization: number;
}

interface Erc4626State {
  pps: string;
  ts: number;
  apyBps: number;
}

const statePathFor = (vault: Address): string =>
  join(RECEIPTS_DIR, `erc4626feed-${vault.toLowerCase()}.json`);

const writeState = (path: string, s: Erc4626State): void => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(s));
  } catch {
    /* best-effort cache; on an ephemeral FS the feed simply keeps using the fallback */
  }
};

/**
 * Read the vault's live APY (from the share-price delta since the last reading) plus its `totalAssets`
 * as TVL. `fallbackApyBps` is used only until a full smoothing window has elapsed.
 */
export async function readErc4626Market(
  pc: PublicClient,
  vault: Address,
  fallbackApyBps: number,
): Promise<Erc4626Market> {
  const [ppsNow, totalAssets, asset] = await Promise.all([
    pc.readContract({ address: vault, abi: vaultAbi, functionName: "convertToAssets", args: [ONE] }),
    pc.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
    pc.readContract({ address: vault, abi: vaultAbi, functionName: "asset" }),
  ]);
  const assetDec = await pc.readContract({ address: asset, abi: erc20, functionName: "decimals" });
  const tvlUsd = Number(totalAssets) / 10 ** Number(assetDec);

  const block = await pc.getBlock();
  const now = Number(block.timestamp);

  const path = statePathFor(vault);
  let prev: Erc4626State | null = null;
  try {
    if (existsSync(path)) prev = JSON.parse(readFileSync(path, "utf8")) as Erc4626State;
  } catch {
    prev = null;
  }

  let apyBps: number;
  if (prev && now - prev.ts >= MIN_PERIOD_SEC) {
    apyBps = erc4626ApyBps(BigInt(prev.pps), ppsNow, now - prev.ts);
    writeState(path, { pps: ppsNow.toString(), ts: now, apyBps });
  } else if (prev) {
    apyBps = prev.apyBps; // inside the smoothing window: reuse the last computed rate
  } else {
    apyBps = fallbackApyBps; // cold start: seed the window, use the fallback until one elapses
    writeState(path, { pps: ppsNow.toString(), ts: now, apyBps });
  }

  return { apyBps, tvlUsd, liquidityUsd: tvlUsd, utilization: 0 };
}
