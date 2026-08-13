import type { PublicClient } from "viem";
import { vaultAbi, erc20Abi } from "./abi.js";
import type { Address, VaultState, VenueMeta, VenueState } from "../types.js";
import { readAaveMarket } from "../sense/aaveFeed.js";
import { readPendleMarket } from "../sense/pendleFeed.js";
import { readPeg } from "../sense/pegFeed.js";

export async function readVaultState(
  pc: PublicClient,
  vault: Address,
): Promise<VaultState> {
  const c = { address: vault, abi: vaultAbi } as const;
  const [
    asset,
    owner,
    agent,
    maxMoveSize,
    perVenueCap,
    maxTotalDeployed,
    totalDeployed,
    idle,
    paused,
  ] = await Promise.all([
    pc.readContract({ ...c, functionName: "asset" }),
    pc.readContract({ ...c, functionName: "owner" }),
    pc.readContract({ ...c, functionName: "agent" }),
    pc.readContract({ ...c, functionName: "maxMoveSize" }),
    pc.readContract({ ...c, functionName: "perVenueCap" }),
    pc.readContract({ ...c, functionName: "maxTotalDeployed" }),
    pc.readContract({ ...c, functionName: "totalDeployed" }),
    pc.readContract({ ...c, functionName: "idleBalance" }),
    pc.readContract({ ...c, functionName: "paused" }),
  ]);

  const [decimals, symbol] = await Promise.all([
    pc.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" }),
    pc.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }),
  ]);

  // Per-epoch churn budgets, read defensively: a pool that predates these getters simply reports
  // null and the fingerprint omits them (F-4). One missing selector must not fail the whole read.
  const readOpt = async (
    functionName: "maxEpochLoss" | "lossEpochLength" | "maxEpochDeploy" | "deployEpochLength",
  ): Promise<bigint | null> => {
    try {
      return (await pc.readContract({ ...c, functionName })) as bigint;
    } catch {
      return null;
    }
  };
  const [maxEpochLoss, lossEpochLength, maxEpochDeploy, deployEpochLength] = await Promise.all([
    readOpt("maxEpochLoss"),
    readOpt("lossEpochLength"),
    readOpt("maxEpochDeploy"),
    readOpt("deployEpochLength"),
  ]);

  return {
    address: vault,
    asset,
    owner,
    agent,
    decimals: Number(decimals),
    symbol,
    idle,
    totalDeployed,
    maxMoveSize,
    perVenueCap,
    maxTotalDeployed,
    paused,
    maxEpochLoss,
    lossEpochLength,
    maxEpochDeploy,
    deployEpochLength,
  };
}

/** A single depositor's stake in the pool, read on-chain the same way the dApp shows it. */
export interface DepositorPosition {
  shares: bigint; // pool shares held
  sharePct: number; // shares / totalSupply, 0..1
  redeemable: bigint; // maxWithdraw: assets they could pull now, incl. accrued yield
}

/**
 * Read one depositor's position from the pool. `redeemable` is maxWithdraw (the same number the
 * "Your position" card shows), and `sharePct` is their fraction of all shares — enough to slice
 * each venue's live balance pro-rata. Returns null shares=0 for a non-depositor.
 */
export async function readDepositorPosition(
  pc: PublicClient,
  vault: Address,
  who: Address,
): Promise<DepositorPosition> {
  const c = { address: vault, abi: vaultAbi } as const;
  const [shares, supply, redeemable] = await Promise.all([
    pc.readContract({ ...c, functionName: "balanceOf", args: [who] }),
    pc.readContract({ ...c, functionName: "totalSupply" }),
    pc.readContract({ ...c, functionName: "maxWithdraw", args: [who] }),
  ]);
  const sharePct = supply > 0n ? Number(shares) / Number(supply) : 0;
  return { shares, sharePct, redeemable };
}

export async function readVenueState(
  pc: PublicClient,
  vault: Address,
  meta: VenueMeta,
): Promise<VenueState> {
  const c = { address: vault, abi: vaultAbi } as const;
  const [allowed, allocatedPrincipal, liveBalance] = await Promise.all([
    pc.readContract({ ...c, functionName: "venueAllowed", args: [meta.address] }),
    pc.readContract({ ...c, functionName: "allocated", args: [meta.address] }),
    pc.readContract({ ...c, functionName: "venueBalance", args: [meta.address] }),
  ]);

  // Live market data overrides the static config when a feed is configured.
  let market = {
    apyBps: meta.apyBps,
    tvlUsd: meta.tvlUsd,
    liquidityUsd: meta.liquidityUsd,
    utilization: meta.utilization,
  };
  if (meta.feed?.source === "aave") {
    try {
      const m = await readAaveMarket(pc, meta.feed.pool, meta.feed.underlying);
      market = { apyBps: m.apyBps, tvlUsd: m.tvlUsd, liquidityUsd: m.liquidityUsd, utilization: m.utilization };
    } catch {
      // fall back to static metrics if the live read fails
    }
  } else if (meta.feed?.source === "pendle") {
    try {
      const m = await readPendleMarket(pc, meta.feed.oracle, meta.feed.market, meta.feed.sy, meta.feed.pt, meta.feed.twapWindowSec);
      market = { apyBps: m.apyBps, tvlUsd: m.tvlUsd, liquidityUsd: m.liquidityUsd, utilization: m.utilization };
    } catch {
      // fall back to static metrics if the live read fails
    }
  }

  // Live peg (F-2): measure the yield asset's deviation from $1 on-chain. Keep the higher of the
  // curated static floor and the live reading so a benign spot can't mask a curated concern, and
  // only trust `pegVerified` when a TWAP produced it. Any failure leaves the venue unverified, which
  // makes the risk engine floor its peg risk — fail conservative, never silently perfect-pegged.
  let pegDeviationBps = meta.pegDeviationBps;
  let pegVerified = meta.pegVerified ?? false;
  if (meta.pegSource) {
    try {
      const p = await readPeg(pc, meta.pegSource);
      pegDeviationBps = Math.max(meta.pegDeviationBps, p.pegDeviationBps);
      pegVerified = p.verified;
    } catch {
      pegVerified = false;
    }
  }

  return { ...meta, ...market, pegDeviationBps, pegVerified, allowed, allocatedPrincipal, liveBalance };
}
