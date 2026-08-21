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
// Minimum risk-adjusted yield edge (annualized bps) before the planner will ROTATE capital out of a
// held venue into a better one. A one-time round-trip swap cost is paid on every rotation, so the
// edge must be large enough that even over a modest horizon the pickup clears it — this filters
// churn on trivial (sub-2%) differences. The on-chain per-epoch loss budget hard-caps the realized
// cost regardless, so this is the "worth it" gate, not the safety bound.
export const REBALANCE_MIN_EDGE_BPS = 200;
// Conservative estimate of the round-trip cost (bps of the moved amount) to rotate into and later out
// of a venue: entry swap + eventual exit. Used only to gate rotations into a FIXED-MATURITY venue,
// where the annualized edge is earned over a shrinking horizon — the pickup (edge × years-to-maturity)
// must clear this, or the position matures before the round-trip pays for itself. Deliberately high so
// the agent never chases annualized yield it cannot actually realize before maturity.
export const ROTATION_ROUNDTRIP_BPS = 100;
// Depeg circuit breaker: the hard peg-deviation threshold (bps) past which the agent forces an
// immediate, full exit from an RWA venue, independent of the graduated risk band. A dollar-pegged
// RWA that has slipped 1% is a red alert, not a slow-scoring input, so the agent gets out now rather
// than waiting for the band to catch up. Retreat is never blocked, so this always executes.
export const HARD_PEG_BREAK_BPS = 100;

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

  // Recompute the plan keeping retreats and only the un-vetoed allocations. A rotation's deallocate
  // is credited at its full amount (idle-neutral — it funds the paired deposit), so a rotation never
  // looks like it draws down the buffer here.
  const kept = plan.moves.filter((m) => m.action !== "allocate" || !vetoes.has(m.venue.toLowerCase()));
  const allocSum = kept.filter((m) => m.action === "allocate").reduce((a, m) => a + m.amount, 0n);
  const deallocPrincipal = kept
    .filter((m) => m.action === "deallocate")
    .reduce((a, m) => {
      if (m.rebalance) return a + m.amount;
      const v = snap.venues.find((x) => x.address === m.venue);
      const principal = v?.allocatedPrincipal ?? 0n;
      return a + (m.amount > principal ? principal : m.amount);
    }, 0n);
  const idleAfter = snap.vault.idle - allocSum + deallocPrincipal;
  const totalDeployedAfter = snap.vault.totalDeployed + allocSum - deallocPrincipal;

  // Dry-powder floor: would this plan leave the pool with too little idle to serve exits? Only a
  // plan that NET-REDUCES idle below the floor is doubted — a rotation (deallocate one venue, deposit
  // the same asset straight into another) is idle-neutral, so it must not be blocked by a buffer it
  // never touches. Real idle deployments still trip this.
  const pool = Number(snap.vault.idle + snap.vault.totalDeployed) / unit;
  const idleAfterPct = pool > 0 ? Number(idleAfter) / unit / pool : 1;
  const reducesIdle = idleAfter < snap.vault.idle;
  let doubt = false;
  if (pool > 0 && reducesIdle && idleAfterPct < IDLE_FLOOR) {
    doubt = true;
    concerns.push(
      `Idle buffer would fall to ${(idleAfterPct * 100).toFixed(
        1,
      )}% of the pool (floor ${(IDLE_FLOOR * 100).toFixed(0)}%). Holding this cycle for exit safety.`,
    );
  }

  // On doubt, hold: drop all allocations (keep retreats — de-risking is never blocked).
  let finalMoves = doubt ? kept.filter((m) => m.action !== "allocate") : kept;
  // A rotation's two legs are atomic: the deallocate is only valid alongside its allocate. If that
  // allocate was vetoed or dropped by doubt, drop the paired rebalance deallocate too — never pull
  // capital out of the source venue without funding the target, which would strand it in idle.
  const hasRebalAlloc = finalMoves.some((m) => m.rebalance && m.action === "allocate");
  if (!hasRebalAlloc) {
    finalMoves = finalMoves.filter((m) => !(m.rebalance && m.action === "deallocate"));
  }

  const dAllocSum = finalMoves.filter((m) => m.action === "allocate").reduce((a, m) => a + m.amount, 0n);
  const dDeallocPrincipal = finalMoves
    .filter((m) => m.action === "deallocate")
    .reduce((a, m) => {
      if (m.rebalance) return a + m.amount;
      const v = snap.venues.find((x) => x.address === m.venue);
      const principal = v?.allocatedPrincipal ?? 0n;
      return a + (m.amount > principal ? principal : m.amount);
    }, 0n);
  const dIdleAfter = snap.vault.idle - dAllocSum + dDeallocPrincipal;
  const dTotalDeployedAfter = snap.vault.totalDeployed + dAllocSum - dDeallocPrincipal;

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
