import type { VenueSample } from "../types.js";

/**
 * Temporal awareness. Levels alone miss a deteriorating venue: 70% utilization that has been flat
 * is very different from 70% that climbed from 45% in three cycles. This turns a venue's recent
 * history into an ADVERSE-trend score in [0,1] — it only ever rises when things are getting worse
 * (utilization climbing, peg widening, exit liquidity thinning, or APY spiking as a venue pays up
 * for fleeing liquidity). Favourable trends do not lower risk here; the risk engine stays
 * conservative and the score is used only as an additive penalty on top of the level-based score.
 */

const clamp01 = (x: number): number =>
  Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;

export interface Momentum {
  utilizationDelta: number; // current minus baseline, in 0..1 units (positive = rising)
  pegDeltaBps: number; // positive = widening off peg
  depthRatioDelta: number; // current minus baseline liquidity/TVL (negative = thinning)
  apyDeltaBps: number; // positive = spiking
  momentumRisk: number; // 0..1 adverse-trend intensity
  notes: string[];
}

const EMPTY: Momentum = {
  utilizationDelta: 0,
  pegDeltaBps: 0,
  depthRatioDelta: 0,
  apyDeltaBps: 0,
  momentumRisk: 0,
  notes: [],
};

const depthRatio = (s: VenueSample): number => (s.tvlUsd > 0 ? s.liquidityUsd / s.tvlUsd : 0);

/**
 * Compare the current sample to the mean of up to the last `window` prior samples. History is
 * oldest-first and must NOT include the current observation.
 */
export function computeMomentum(
  current: VenueSample,
  history: VenueSample[] | undefined,
  window = 5,
): Momentum {
  if (!history || history.length === 0) return EMPTY;
  const w = history.slice(-window);
  const mean = (f: (s: VenueSample) => number) => w.reduce((a, s) => a + f(s), 0) / w.length;

  const utilizationDelta = current.utilization - mean((s) => s.utilization);
  const pegDeltaBps = current.pegDeviationBps - mean((s) => s.pegDeviationBps);
  const depthRatioDelta = depthRatio(current) - mean(depthRatio);
  const apyDeltaBps = current.apyBps - mean((s) => s.apyBps);

  // Normalize each adverse move onto 0..1 (the divisor is the change that fully saturates it), then
  // blend by importance: rising utilization and a widening peg are the strongest distress signals.
  const utilRise = clamp01(Math.max(0, utilizationDelta) / 0.2); // +20pp saturates
  const pegWiden = clamp01(Math.max(0, pegDeltaBps) / 100); // +100bps saturates
  const depthDrop = clamp01(Math.max(0, -depthRatioDelta) / 0.3); // -30pp depth saturates
  const apySpike = clamp01(Math.max(0, apyDeltaBps) / 500); // +5% APY saturates
  const momentumRisk = clamp01(
    0.4 * utilRise + 0.3 * pegWiden + 0.2 * depthDrop + 0.1 * apySpike,
  );

  const notes: string[] = [];
  const baseUtil = mean((s) => s.utilization);
  if (utilizationDelta > 0.05)
    notes.push(
      `utilization rising (${(baseUtil * 100).toFixed(0)}%→${(current.utilization * 100).toFixed(0)}%)`,
    );
  if (pegDeltaBps > 15) notes.push(`peg widening (+${Math.round(pegDeltaBps)}bps)`);
  if (depthRatioDelta < -0.05) notes.push("exit liquidity thinning");
  if (apyDeltaBps > 200) notes.push(`APY spiking (+${(apyDeltaBps / 100).toFixed(1)}%)`);

  return { utilizationDelta, pegDeltaBps, depthRatioDelta, apyDeltaBps, momentumRisk, notes };
}
