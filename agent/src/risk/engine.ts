import type { RiskBand, VenueState } from "../types.js";

/**
 * The risk engine. It does NOT chase APY. For each venue it decomposes risk into
 * transparent, bounded sub-scores, blends them into a single 0..1 risk score, maps
 * that to a band, and haircuts the headline APY into a risk-adjusted yield the
 * allocator ranks on. Every number here is explainable and shows up in the receipt.
 */

export interface VenueRisk {
  address: `0x${string}`;
  name: string;
  apyBps: number;
  protocolRisk: number;
  liquidityRisk: number;
  pegRisk: number;
  utilizationRisk: number;
  concentrationRisk: number;
  riskScore: number; // 0..1 blended (higher = riskier)
  band: RiskBand;
  riskAdjustedApyBps: number; // apyBps * (1 - riskScore)
  notes: string[];
}

const clamp01 = (x: number): number =>
  Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 1;

// Weights sum to 1. Protocol and liquidity dominate: an unproven venue or one you
// cannot exit is worse than one running a little hot.
const W = {
  protocol: 0.3,
  liquidity: 0.25,
  peg: 0.2,
  utilization: 0.15,
  concentration: 0.1,
} as const;

export function bandOf(score: number): RiskBand {
  if (score < 0.25) return "low";
  if (score < 0.5) return "moderate";
  if (score < 0.75) return "elevated";
  return "high";
}

export const BAND_RANK: Record<RiskBand, number> = {
  low: 0,
  moderate: 1,
  elevated: 2,
  high: 3,
};

export function scoreVenue(
  v: VenueState,
  decimals: number,
  portfolioUnits: number,
): VenueRisk {
  const notes: string[] = [];
  const unit = 10 ** decimals;

  const protocolRisk = clamp01(v.protocolRisk);
  if (protocolRisk >= 0.5) notes.push("unproven or high base protocol risk");

  // Liquidity: thin withdrawable liquidity relative to TVL is hard to exit.
  const liqRatio = v.tvlUsd > 0 ? v.liquidityUsd / v.tvlUsd : 0;
  const liquidityRisk = clamp01(1 - liqRatio);
  if (liqRatio < 0.1) notes.push("thin exit liquidity (<10% of TVL)");

  // Peg: RWA / yield-asset deviation from $1. 2% off peg saturates.
  const pegRisk = clamp01(v.pegDeviationBps / 200);
  if (v.pegDeviationBps >= 50) notes.push(`asset ${v.pegDeviationBps}bps off $1`);

  // Utilization: only meaningful for lending. Risk climbs above 80% used.
  const utilizationRisk =
    v.kind === "lending" ? clamp01((v.utilization - 0.8) / 0.2) : 0;
  if (v.kind === "lending" && v.utilization > 0.9)
    notes.push(`utilization ${(v.utilization * 100).toFixed(0)}%`);

  // Concentration: how much of the whole portfolio already sits in this venue.
  const deployedUnits = Number(v.allocatedPrincipal) / unit;
  const concentrationRisk =
    portfolioUnits > 0 ? clamp01(deployedUnits / portfolioUnits) : 0;

  const riskScore = clamp01(
    W.protocol * protocolRisk +
      W.liquidity * liquidityRisk +
      W.peg * pegRisk +
      W.utilization * utilizationRisk +
      W.concentration * concentrationRisk,
  );

  return {
    address: v.address,
    name: v.name,
    apyBps: v.apyBps,
    protocolRisk,
    liquidityRisk,
    pegRisk,
    utilizationRisk,
    concentrationRisk,
    riskScore,
    band: bandOf(riskScore),
    riskAdjustedApyBps: Math.round(v.apyBps * (1 - riskScore)),
    notes,
  };
}
