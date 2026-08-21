import type { RiskBand, VenueState, VenueHistory } from "../types.js";
import { computeMomentum } from "./momentum.js";

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
  momentumRisk: number; // 0..1 adverse-trend intensity from recent history (0 when no history)
  correlatedExposure: number; // 0..1 share of the portfolio in this venue + correlated venues
  dataStale: boolean; // live market feed failed this cycle → venue is on stale static data
  redemptionGated: boolean; // exit is currently impaired (util-gated lending, or position > exit depth)
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
// How much an adverse trend can add to a venue's level-based risk. Bounded and additive so history
// nudges the ranking (a deteriorating venue loses ground) without ever dominating the levels.
const MOMENTUM_PENALTY = 0.15;

// RWA-intelligence: an RWA venue's exit can be gated even when its yield looks fine, and its live
// data can go stale. These are the two failure modes generic yield bots miss.
// A lending reserve at/above this utilization gates withdrawals (borrowers hold the liquidity).
const GATE_UTILIZATION = 0.98;
// Flying blind on a venue's live feed is itself a risk: added to the score so a stale venue de-rates.
const DATA_STALE_RISK = 0.25;
// A gated exit is a real hazard to hold; add a strong penalty so a gated venue de-rates toward the
// elevated/high band. The planner additionally refuses fresh capital outright (a hard block), while a
// natural band crossing drives any retreat — we never force a full-position exit that could revert on
// a genuinely trapped venue and stall the cycle; the owner's setVenueImpaired / emergencyWithdraw are
// the hard-freeze escalation.
const GATE_RISK = 0.3;

export function scorePortfolio(
  venues: VenueState[],
  decimals: number,
  portfolioUnits: number,
  history?: VenueHistory,
  momentumCalibration = 1,
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
    // Fail conservative (F-2): if this is an RWA venue whose peg was NOT verified from a live source
    // this cycle, we must not treat a static/zero pegDeviationBps as a perfect peg — that silently
    // disables the peg guardrail, the single most important signal for an RWA/stablecoin strategy.
    // Floor peg risk at a cautious level so the peg weight always bites for an unmonitored RWA venue;
    // a real live-peg read (pegVerified=true) uses the measured value instead.
    const pegCeiling = v.kind === "rwa" ? 150 : 200; // bps at which peg risk saturates
    const measuredPegRisk = clamp01(v.pegDeviationBps / pegCeiling);
    const pegUnverified = v.kind === "rwa" && v.pegVerified !== true;
    const PEG_UNVERIFIED_FLOOR = 0.5; // an unmonitored RWA peg is treated as materially uncertain
    const pegRisk = pegUnverified
      ? Math.max(measuredPegRisk, PEG_UNVERIFIED_FLOOR)
      : measuredPegRisk;
    if (pegUnverified) notes.push("RWA peg unverified — scored conservatively");
    else if (v.pegDeviationBps >= 50) notes.push(`asset ${v.pegDeviationBps}bps off $1`);

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

    // --- Momentum: is this venue getting WORSE over recent cycles? Level-based risk is blind to a
    // venue climbing toward danger; the trend penalty makes a deteriorating venue rank riskier. ---
    const mom = computeMomentum(
      {
        utilization: v.utilization,
        pegDeviationBps: v.pegDeviationBps,
        liquidityUsd: v.liquidityUsd,
        tvlUsd: v.tvlUsd,
        apyBps: v.apyBps,
      },
      history?.[v.address.toLowerCase()],
    );
    const momentumRisk = mom.momentumRisk;
    for (const n of mom.notes) notes.push(n);

    // --- RWA intelligence: data staleness + redemption-gate detection ---
    // Data staleness: the live feed failed this cycle, so we're on stale static numbers. Treat it as
    // real risk (we can't currently price the venue) rather than silently trusting the fallback.
    const dataStale = v.feedVerified === false;
    if (dataStale) notes.push("live feed stale this cycle — venue de-rated, no fresh capital");
    // Redemption gate: exit is currently impaired. Two triggers — a lending reserve utilized to the
    // point that withdrawals are gated (borrowers hold the liquidity), or our own position exceeding
    // the venue's withdrawable depth so we could not exit it in one move. Either way, do not add.
    const utilGated = v.kind === "lending" && v.utilization >= GATE_UTILIZATION;
    const exitTrapped = positionUsd > 0 && v.liquidityUsd < positionUsd;
    const redemptionGated = utilGated || exitTrapped;
    if (utilGated) notes.push(`redemption gated — utilization ${(v.utilization * 100).toFixed(0)}% ≥ ${(GATE_UTILIZATION * 100).toFixed(0)}%`);
    if (exitTrapped) notes.push("redemption gated — position exceeds withdrawable depth");

    const levelScore =
      W.protocol * protocolRisk +
      W.liquidity * liquidityRisk +
      W.peg * pegRisk +
      W.utilization * utilizationRisk +
      W.concentration * concentrationRisk;
    // Reflection can scale the momentum penalty UP (never below 1x) when trend has been predictive.
    const cal = Math.max(1, momentumCalibration);
    const riskScore = clamp01(
      levelScore +
        MOMENTUM_PENALTY * cal * momentumRisk +
        (dataStale ? DATA_STALE_RISK : 0) +
        (redemptionGated ? GATE_RISK : 0),
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
      momentumRisk,
      correlatedExposure,
      dataStale,
      redemptionGated,
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
  history?: VenueHistory,
): VenueRisk {
  return scorePortfolio([v], decimals, portfolioUnits, history)[0]!;
}
