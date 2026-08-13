import type { MarketSnapshot } from "../types.js";
import type { Plan } from "./plan.js";

/**
 * The critic — an adversarial second perspective, run AFTER the planner and the LLM. Where the risk
 * engine asks "is this venue acceptable?", the critic asks "how could THIS SPECIFIC PLAN lose money?"
 * and looks at angles the ranking doesn't: are we adding to a venue that is actively deteriorating,
 * taking too large a share of a single venue's exit liquidity, or leaving too little dry powder? It
 * can only ever remove allocations (veto) or, on a serious unresolved worry, escalate a DOUBT that
 * holds the whole cycle. Deterministic, tighten-only, and recorded — a skeptic that never loosens.
 */

export interface CriticVerdict {
  approved: boolean; // false = the critic forced a hold (doubt)
  vetoes: string[]; // venue addresses whose new allocation the critic removed
  concerns: string[];
  doubt: boolean; // a serious, unresolved risk → escalate / hold this cycle
}

// Thresholds are intentionally stricter than the engine's — the critic is the second opinion.
export const MOMENTUM_VETO = 0.5; // don't ADD to a venue this far into deterioration
export const LIQUIDITY_SHARE_CAP = 0.25; // a position may not exceed this share of a venue's exit liquidity
export const IDLE_FLOOR = 0.05; // keep at least this share of the pool as dry powder

export function critique(snap: MarketSnapshot, plan: Plan): Plan {
  const dec = snap.vault.decimals;
  const unit = 10 ** dec;
  const riskByAddr = new Map(plan.risks.map((r) => [r.address.toLowerCase(), r]));
  const vetoes = new Set<string>();
  const concerns: string[] = [];

  for (const m of plan.moves) {
    if (m.action !== "allocate") continue;
    const key = m.venue.toLowerCase();
    const r = riskByAddr.get(key);
    const v = snap.venues.find((x) => x.address.toLowerCase() === key);
    if (r && r.momentumRisk > MOMENTUM_VETO) {
      vetoes.add(key);
      concerns.push(
        `Refused to add to ${m.venueName}: it is actively deteriorating (momentum ${(
          r.momentumRisk * 100
        ).toFixed(0)}/100).`,
      );
      continue;
    }
    if (v && v.liquidityUsd > 0) {
      const postPos = Number(v.allocatedPrincipal + m.amount) / unit;
      if (postPos > LIQUIDITY_SHARE_CAP * v.liquidityUsd) {
        vetoes.add(key);
        concerns.push(
          `Refused ${m.venueName}: the position would exceed ${(LIQUIDITY_SHARE_CAP * 100).toFixed(
            0,
          )}% of its exit liquidity — too much to unwind in one move.`,
        );
      }
    }
  }

  // Recompute the plan keeping retreats and only the un-vetoed allocations.
  const kept = plan.moves.filter((m) => m.action !== "allocate" || !vetoes.has(m.venue.toLowerCase()));
  const allocSum = kept.filter((m) => m.action === "allocate").reduce((a, m) => a + m.amount, 0n);
  const deallocPrincipal = kept
    .filter((m) => m.action === "deallocate")
    .reduce((a, m) => {
      const v = snap.venues.find((x) => x.address === m.venue);
      const principal = v?.allocatedPrincipal ?? 0n;
      return a + (m.amount > principal ? principal : m.amount);
    }, 0n);
  const idleAfter = snap.vault.idle - allocSum + deallocPrincipal;
  const totalDeployedAfter = snap.vault.totalDeployed + allocSum - deallocPrincipal;

  // Dry-powder floor: would this plan leave the pool with too little idle to serve exits?
  const pool = Number(snap.vault.idle + snap.vault.totalDeployed) / unit;
  const idleAfterPct = pool > 0 ? Number(idleAfter) / unit / pool : 1;
  let doubt = false;
  if (pool > 0 && allocSum > 0n && idleAfterPct < IDLE_FLOOR) {
    doubt = true;
    concerns.push(
      `Idle buffer would fall to ${(idleAfterPct * 100).toFixed(
        1,
      )}% of the pool (floor ${(IDLE_FLOOR * 100).toFixed(0)}%). Holding this cycle for exit safety.`,
    );
  }

  // On doubt, hold: drop all allocations (keep retreats — de-risking is never blocked).
  const finalMoves = doubt ? kept.filter((m) => m.action !== "allocate") : kept;
  const dAllocSum = finalMoves.filter((m) => m.action === "allocate").reduce((a, m) => a + m.amount, 0n);
  const dIdleAfter = snap.vault.idle - dAllocSum + deallocPrincipal;
  const dTotalDeployedAfter = snap.vault.totalDeployed + dAllocSum - deallocPrincipal;

  const critic: CriticVerdict = { approved: !doubt, vetoes: [...vetoes], concerns, doubt };
  const changed = vetoes.size > 0 || doubt;
  return {
    ...plan,
    moves: finalMoves,
    idleAfter: dIdleAfter,
    totalDeployedAfter: dTotalDeployedAfter,
    critic,
    summary: changed
      ? `${plan.summary} Critic: ${concerns.join(" ")}`
      : plan.summary,
  };
}
