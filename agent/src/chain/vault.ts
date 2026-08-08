import type { PublicClient } from "viem";
import { vaultAbi, erc20Abi } from "./abi.js";
import type { Address, VaultState, VenueMeta, VenueState } from "../types.js";
import { readAaveMarket } from "../sense/aaveFeed.js";

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
  };
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
  }

  return { ...meta, ...market, allowed, allocatedPrincipal, liveBalance };
}
