import type { Address, MarketSnapshot, VaultState, VenueState } from "../src/types.js";

const A = (n: number): Address =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;

export const VENUE_A = A(1);
export const VENUE_B = A(2);

const M = 1_000_000n; // 1 unit at 6 decimals

export function venue(over: Partial<VenueState> = {}): VenueState {
  return {
    address: VENUE_A,
    name: "V",
    kind: "lending",
    apyBps: 800,
    tvlUsd: 1_000_000,
    liquidityUsd: 500_000,
    utilization: 0.5,
    protocolRisk: 0.1,
    pegDeviationBps: 0,
    allowed: true,
    allocatedPrincipal: 0n,
    liveBalance: 0n,
    ...over,
  };
}

export function snap(
  overVault: Partial<VaultState> = {},
  venues: VenueState[] = [venue()],
): MarketSnapshot {
  const vault: VaultState = {
    address: A(0xa),
    asset: A(0xb),
    owner: A(0xc),
    agent: A(0xc),
    decimals: 6,
    symbol: "USDT0",
    idle: 1000n * M,
    totalDeployed: 0n,
    maxMoveSize: 100n * M,
    perVenueCap: 500n * M,
    maxTotalDeployed: 1000n * M,
    paused: false,
    ...overVault,
  };
  return { vault, venues, takenAt: "test" };
}

export { M };
