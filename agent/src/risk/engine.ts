import type { RiskBand, VenueState } from "../types.js";

/**
 * The risk engine. It does NOT chase APY. For each venue it decomposes risk into
 * transparent, bounded sub-scores, blends them into a single 0..1 risk score, maps that to a
 * band, and haircuts the headline APY into a risk-adjusted yield the allocator ranks on. Every
 * number is explainable and shows up in the receipt.
 *
 * Two of the sub-scores are portfolio-aware, so venues are scored together, not one at a time:
 *  - liquidity risk blends the venue's own depth with whether WE can exit OUR position;
 *  - concentration risk is correlation-aware — exposure to a venue plus everything correlated
 *    with it (two lending venues are not independent), so diversifying across uncorrelated
 *    venues genuinely lowers risk while splitting across correlated ones does not.
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
  correlatedExposure: number; // 0..1 share of the portfolio in this venue + correlated venues
  riskScore: number; // 0..1 blended (higher = riskier)
  band: RiskBand;
  riskAdjustedApyBps: number; // apyBps * (1 - riskScore)
  notes: string[];
}

const clamp01 = (x: number): number =>
  Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 1;

// Weights sum to 1. Protocol and liquidity dominate: an unproven venue or one you cannot exit
// is worse than one running a little hot.
const W = {
  protocol: 0.3,
  liquidity: 0.25,
  peg: 0.2,
  utilization: 0.15,
  concentration: 0.1,
} as const;

// Pairwise correlation between venue kinds. Same kind shares protocol/market shocks; different
// kinds are largely (not fully) independent. Used for correlation-aware concentration.
const SAME_KIND_RHO = 0.75;
const CROSS_KIND_RHO = 0.2;

function rho(a: VenueState["kind"], b: VenueState["kind"]): number {
  return a === b ? SAME_KIND_RHO : CROSS_KIND_RHO;
}

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

/**
 * Score every venue together. `portfolioUnits` is the whole pool (idle + deployed) in asset
 * units; weights are each venue's current principal as a share of that.
 */
export function scorePortfolio(
  venues: VenueState[],
  decimals: number,
  portfolioUnits: number,
): VenueRisk[] {
  const unit = 10 ** decimals;
  const weight = (v: VenueState) =>
    portfolioUnits > 0 ? clamp01(Number(v.allocatedPrincipal) / unit / portfolioUnits) : 0;

  return venues.map((v) => {
    const notes: string[] = [];

    const protocolRisk = clamp01(v.protocolRisk);
    if (protocolRisk >= 0.5) notes.push("unproven or high base protocol risk");

    // --- Liquidity risk: venue depth AND our own exit capacity ---
    // Depth: thin withdrawable liquidity relative to TVL is systemically hard to exit.
    const depthRatio = v.tvlUsd > 0 ? clamp01(v.liquidityUsd / v.tvlUsd) : 0;
    const depthRisk = 1 - depthRatio;
    // Exit: our current position relative to what can be withdrawn right now. If our position
    // approaches or exceeds available liquidity, we cannot get out in one move.
    const positionUsd = (Number(v.allocatedPrincipal) / unit) || 0;
    const exitRisk = v.liquidityUsd > 0 ? clamp01(positionUsd / v.liquidityUsd) : positionUsd > 0 ? 1 : 0;
    const liquidityRisk = clamp01(0.6 * depthRisk + 0.4 * exitRisk);
    if (depthRatio < 0.1) notes.push("thin venue liquidity (<10% of TVL)");
    if (exitRisk > 0.5) notes.push("our position is large vs withdrawable liquidity");

    // --- Peg: RWA / yield-asset deviation from $1; RWA assets are more peg-sensitive ---
    const pegCeiling = v.kind === "rwa" ? 150 : 200; // bps at which peg risk saturates
    const pegRisk = clamp01(v.pegDeviationBps / pegCeiling);
    if (v.pegDeviationBps >= 50) notes.push(`asset ${v.pegDeviationBps}bps off $1`);

    // --- Utilization: lending only. High utilization means withdrawals can be gated ---
    const utilizationRisk =
      v.kind === "lending" ? clamp01((v.utilization - 0.8) / 0.2) : 0;
    if (v.kind === "lending" && v.utilization > 0.9)
      notes.push(`utilization ${(v.utilization * 100).toFixed(0)}%`);

    // --- Concentration: correlation-aware exposure to this venue + everything like it ---
    // A venue is fully correlated with itself (1.0); others contribute by kind correlation.
    const correlatedExposure = clamp01(
      venues.reduce(
        (acc, other) => acc + (other === v ? 1 : rho(v.kind, other.kind)) * weight(other),
        0,
      ),
    );
    const concentrationRisk = correlatedExposure;
    if (correlatedExposure > 0.6) notes.push("high correlated concentration");

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
      correlatedExposure,
      riskScore,
      band: bandOf(riskScore),
      riskAdjustedApyBps: Math.round(v.apyBps * (1 - riskScore)),
      notes,
    };
  });
}

/** Single-venue convenience (no cross-venue correlation). */
export function scoreVenue(
  v: VenueState,
  decimals: number,
  portfolioUnits: number,
): VenueRisk {
  return scorePortfolio([v], decimals, portfolioUnits)[0]!;
}
