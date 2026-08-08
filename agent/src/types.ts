export type Address = `0x${string}`;

export type RiskBand = "low" | "moderate" | "elevated" | "high";
export type Regime = "calm" | "cautious" | "defensive";

/** On-chain state of the vault (the trust core). */
export interface VaultState {
  address: Address;
  asset: Address;
  owner: Address;
  agent: Address;
  decimals: number;
  symbol: string;
  idle: bigint; // asset held by the vault, not deployed
  totalDeployed: bigint; // principal deployed across all venues
  maxMoveSize: bigint; // hard cap per allocate()
  perVenueCap: bigint; // hard cap of principal per venue
  maxTotalDeployed: bigint; // hard global cap
  paused: boolean;
}

/** Optional live-market source. When present, its reads override the static metrics. */
export interface VenueFeed {
  source: "aave";
  pool: Address; // Aave v3 Pool
  underlying: Address; // the reserve asset (USDT0)
}

/** Market metadata for a venue (from the feed). */
export interface VenueMeta {
  address: Address;
  name: string;
  kind: "lending" | "rwa" | "mock";
  apyBps: number; // annualized yield, basis points
  tvlUsd: number;
  liquidityUsd: number; // immediately withdrawable
  utilization: number; // 0..1 (lending)
  protocolRisk: number; // 0..1 curated base risk
  pegDeviationBps: number; // yield-asset deviation from $1
  feed?: VenueFeed; // when set, live reads replace the static market metrics
}

/** Venue metadata joined with its live on-chain position. */
export interface VenueState extends VenueMeta {
  allowed: boolean; // vault.venueAllowed(venue)
  allocatedPrincipal: bigint; // vault.allocated(venue)
  liveBalance: bigint; // vault.venueBalance(venue) — principal + accrued
}

export interface MarketSnapshot {
  vault: VaultState;
  venues: VenueState[];
  takenAt: string; // ISO timestamp
}
