import { parseAbi, type PublicClient, type Address } from "viem";

/**
 * Live market feed for a Pendle PT venue. Derives the metrics the risk engine scores — implied
 * fixed APY to maturity, market TVL, and exit liquidity — from on-chain reads instead of static
 * config, mirroring aaveFeed. Any read failure lets readVenueState fall back to the static metrics.
 *
 * Implied APY comes from the PT oracle's PT-to-asset rate: a PT trading below 1 asset is a discount
 * that annualizes to the fixed yield a buyer locks in to maturity. Liquidity is the market's SY
 * reserve (what it can pay a PT seller now), a conservative floor the risk engine's liquidity-share
 * cap tightens further.
 */

const oracleAbi = parseAbi([
  "function getPtToAssetRate(address market, uint32 duration) view returns (uint256)",
]);
const marketAbi = parseAbi(["function expiry() view returns (uint256)"]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const WAD = 1e18;
const SECONDS_PER_YEAR = 31_536_000;

export interface PendleMarket {
  apyBps: number; // implied fixed APY to maturity, basis points
  tvlUsd: number; // SY + PT reserves valued in asset terms
  liquidityUsd: number; // SY reserve — conservative exit capacity for a PT seller
  utilization: number; // n/a for a PT market; 0
  maturityTs: number; // unix seconds the PT redeems 1:1 — the planner's rotation horizon
}

export async function readPendleMarket(
  pc: PublicClient,
  oracle: Address,
  market: Address,
  sy: Address,
  pt: Address,
  twapWindowSec: number,
): Promise<PendleMarket> {
  const [rate, expiry, syDecimals, syReserve, ptReserve, block] = await Promise.all([
    pc.readContract({ address: oracle, abi: oracleAbi, functionName: "getPtToAssetRate", args: [market, twapWindowSec] }),
    pc.readContract({ address: market, abi: marketAbi, functionName: "expiry" }),
    pc.readContract({ address: sy, abi: erc20Abi, functionName: "decimals" }),
    pc.readContract({ address: sy, abi: erc20Abi, functionName: "balanceOf", args: [market] }),
    pc.readContract({ address: pt, abi: erc20Abi, functionName: "balanceOf", args: [market] }),
    pc.getBlock(),
  ]);

  const unit = 10 ** Number(syDecimals);
  const now = Number(block.timestamp);
  const secondsToMaturity = Math.max(1, Number(expiry) - now);
  const assetPerPt = Number(rate) / WAD; // < 1 for a discount PT

  // Compounded implied APY to maturity: (1 / assetPerPt) ^ (year / timeToMaturity) - 1. Guard the
  // degenerate cases (rate >= 1 or 0) so a bad read yields 0, not NaN/negative.
  let apy = 0;
  if (assetPerPt > 0 && assetPerPt < 1) {
    apy = Math.pow(1 / assetPerPt, SECONDS_PER_YEAR / secondsToMaturity) - 1;
  }

  // SY on a stable (USDG) market values ~1:1 in asset terms; the small ex-rate drift on a fresh
  // market is immaterial to a liquidity/TVL gate that the pool is orders of magnitude below.
  const syAsset = Number(syReserve) / unit;
  const ptAsset = (Number(ptReserve) / unit) * assetPerPt;

  return {
    apyBps: Math.max(0, Math.round(apy * 10000)),
    tvlUsd: syAsset + ptAsset,
    liquidityUsd: syAsset,
    utilization: 0,
    maturityTs: Number(expiry),
  };
}
