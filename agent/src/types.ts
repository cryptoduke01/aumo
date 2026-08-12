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
  // Per-epoch churn budgets. Present only on pools that expose the getters; null when a pool
  // (e.g. an older redeploy) lacks them. Folded into the policy fingerprint so a decision is bound
  // to the loss/deploy limits that were in force when it was made. (F-4)
  maxEpochLoss?: bigint | null;
  lossEpochLength?: bigint | null;
  maxEpochDeploy?: bigint | null;
  deployEpochLength?: bigint | null;
}

/** Optional live-market source. When present, its reads override the static metrics. */
export interface VenueFeed {
  source: "aave";
  pool: Address; // Aave v3 Pool
  underlying: Address; // the reserve asset (USDT0)
}

/**
 * Optional live peg source (F-2): the Uniswap v3 pool that quotes an RWA/stable yield asset against
 * the numeraire (USDT0). When present, `readVenueState` measures the asset's deviation from $1 each
 * cycle and only marks it verified when a manipulation-resistant TWAP is available.
 */
export interface PegSource {
  kind: "univ3Twap";
  pool: Address; // the yield-asset / numeraire Uniswap v3 pool
  yieldToken: Address; // the asset whose $1 peg we measure (e.g. USDG)
  twapWindowSec: number; // TWAP window in seconds; falls back to spot (unverified) if unavailable
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
  pegVerified?: boolean; // true only when pegDeviationBps came from a live peg source this cycle;
  // when false/absent for an RWA venue, the risk engine floors peg risk conservatively (F-2) rather
  // than trusting a static/zero value as a perfect peg
  feed?: VenueFeed; // when set, live reads replace the static market metrics
  pegSource?: PegSource; // when set, the live peg is measured on-chain each cycle (F-2)
}

/** Venue metadata joined with its live on-chain position. */
export interface VenueState extends VenueMeta {
  allowed: boolean; // vault.venueAllowed(venue)
  allocatedPrincipal: bigint; // vault.allocated(venue)
  liveBalance: bigint; // vault.venueBalance(venue) — principal + accrued
}

/** One historical observation of a venue's market metrics, used for temporal/trend awareness. */
export interface VenueSample {
  utilization: number; // 0..1
  pegDeviationBps: number;
  liquidityUsd: number;
  tvlUsd: number;
  apyBps: number;
}

/** Per-venue history keyed by lowercased address, oldest sample first. */
export type VenueHistory = Record<string, VenueSample[]>;

export interface MarketSnapshot {
  vault: VaultState;
  venues: VenueState[];
  takenAt: string; // ISO timestamp
  // Recent history per venue (from prior receipts). When present, the risk engine adds a trend
  // (momentum) penalty so a venue that is deteriorating is scored riskier than its level alone.
  history?: VenueHistory;
  // Reflection-derived multiplier (>= 1) scaling the momentum penalty: the agent trusts trend
  // signals more when they have been predictive. Tighten-only; defaults to 1.
  momentumCalibration?: number;
}
