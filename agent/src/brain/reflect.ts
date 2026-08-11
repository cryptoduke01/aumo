import type { VenueHistory, VenueSample } from "../types.js";
import { computeMomentum } from "../risk/momentum.js";

/**
 * Reflection — the self-evolving loop. After the fact, the agent grades its OWN trend calls: when
 * momentum flagged a venue as deteriorating, did that venue actually keep getting worse the next
 * cycle? A high hit rate means momentum has been predictive here, so the agent should lean on it
 * more; a low one means hold steady. Crucially this is TIGHTEN-ONLY — reflection can raise how much
 * the momentum penalty bites (up to a bound) but never lower it below the base, so a reflective
 * agent can only become more cautious, never talk itself into loosening. The result is recorded as
 * part of the audit trail (experience replay) and fed to the reasoning layer as a short lesson.
 */

const depthRatio = (s: VenueSample): number => (s.tvlUsd > 0 ? s.liquidityUsd / s.tvlUsd : 0);

export interface Reflection {
  flagged: number; // times momentum flagged a venue over the history
  hits: number; // of those, times deterioration continued the next cycle
  hitRate: number; // hits / flagged (0 when nothing flagged)
  calibration: number; // >= 1 multiplier applied to the momentum penalty (tighten-only)
  lessons: string[];
}

const NEUTRAL: Reflection = { flagged: 0, hits: 0, hitRate: 0, calibration: 1, lessons: [] };

/** Replay the history and measure whether momentum predicted continued deterioration. */
export function reflect(history: VenueHistory | undefined): Reflection {
  if (!history) return NEUTRAL;
  let flagged = 0;
  let hits = 0;
  for (const samples of Object.values(history)) {
    // need a prior window (0..i), the current sample (i), and the next (i+1) to grade the call
    for (let i = 1; i < samples.length - 1; i++) {
      const mom = computeMomentum(samples[i]!, samples.slice(0, i));
      if (mom.momentumRisk <= 0.3) continue; // only grade cycles where momentum actually fired
      flagged++;
      const cur = samples[i]!;
      const next = samples[i + 1]!;
      const worsened =
        next.utilization > cur.utilization + 0.01 ||
        depthRatio(next) < depthRatio(cur) - 0.01 ||
        next.pegDeviationBps > cur.pegDeviationBps + 1;
      if (worsened) hits++;
    }
  }
  const hitRate = flagged > 0 ? hits / flagged : 0;
  // Trust momentum more when it has been predictive. Bounded to [1, 1.5] and never below 1.
  const calibration = 1 + 0.5 * hitRate;
  const lessons: string[] = [];
  if (flagged >= 3) {
    lessons.push(
      `Reflection: momentum flagged ${flagged} venue-cycles; deterioration continued in ${hits} (${Math.round(
        hitRate * 100,
      )}%). ${
        hitRate > 0.6
          ? "Trend signals have been predictive — trusting them more this cycle."
          : "Trend signals mixed — holding calibration."
      }`,
    );
  }
  return { flagged, hits, hitRate, calibration, lessons };
}
