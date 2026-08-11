import type { MarketSnapshot, Regime, RiskBand, VenueState } from "../types.js";
import { scorePortfolio, BAND_RANK } from "./engine.js";
import type { Plan } from "../brain/plan.js";

/**
 * Scenario simulation. Scoring the world as it is today is not enough — a venue that looks fine now
 * can be a trap the moment conditions turn. Before a plan is committed, we project the portfolio it
 * WOULD create, apply a set of plausible adverse shocks, and check whether any position we'd hold
 * becomes un-exitable or lands in the top risk band. Venues that fail are denied NEW deploys (we
 * don't add to a one-shock-from-trapped venue), and broad fragility pulls the whole regime down.
 * This is deterministic and complements the LLM: the model can tighten further, never loosen this.
 */

const clamp01 = (x: number): number =>
  Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 1;

export interface ScenarioResult {
  name: string;
  worstBand: RiskBand;
  breaches: string[]; // venue names that become fragile under this scenario
}

export interface StressReport {
  fragile: string[]; // lowercased venue addresses too fragile to deploy MORE into
  fragileNames: string[];
  recommendedRegime: Regime; // regime ceiling implied by systemic fragility
  fragility: number; // 0..1 share of scenarios that produced a breach
  scenarios: ScenarioResult[];
  notes: string[];
}

// Each scenario is a transform on a venue's live market state. Kept plausible, not apocalyptic:
// the point is to avoid traps, not to refuse all yield.
const SCENARIOS: { name: string; shock: (v: VenueState) => VenueState }[] = [
  {
    name: "liquidity crunch (-50% exit liquidity)",
    shock: (v) => ({ ...v, liquidityUsd: v.liquidityUsd * 0.5 }),
  },
  {
    name: "peg shock (+150bps on RWA)",
    shock: (v) => (v.kind === "rwa" ? { ...v, pegDeviationBps: v.pegDeviationBps + 150 } : v),
  },
  {
    name: "utilization spike (lending → 95%)",
    shock: (v) =>
      v.kind === "lending" ? { ...v, utilization: Math.max(v.utilization, 0.95) } : v,
  },
];

/** Project the per-venue principal the plan would leave behind (current +allocs -deallocs). */
function postPlanVenues(snap: MarketSnapshot, plan: Plan): VenueState[] {
  const delta = new Map<string, bigint>();
  for (const m of plan.moves) {
    const k = m.venue.toLowerCase();
    delta.set(k, (delta.get(k) ?? 0n) + (m.action === "allocate" ? m.amount : -m.amount));
  }
  return snap.venues.map((v) => {
    let post = v.allocatedPrincipal + (delta.get(v.address.toLowerCase()) ?? 0n);
    if (post < 0n) post = 0n;
    return { ...v, allocatedPrincipal: post };
  });
}

export function stressTest(snap: MarketSnapshot, plan: Plan, appetite: RiskBand): StressReport {
  const dec = snap.vault.decimals;
  const unit = 10 ** dec;
  const portfolioUnits = (Number(snap.vault.idle) + Number(snap.vault.totalDeployed)) / unit;
  const post = postPlanVenues(snap, plan);

  const fragile = new Set<string>();
  const fragileNames = new Set<string>();
  const scenarios: ScenarioResult[] = [];

  for (const sc of SCENARIOS) {
    const shocked = post.map(sc.shock);
    const scored = scorePortfolio(shocked, dec, portfolioUnits, snap.history);
    const breaches: string[] = [];
    let worst: RiskBand = "low";
    for (let i = 0; i < shocked.length; i++) {
      const v = shocked[i]!;
      const r = scored[i]!;
      if (v.allocatedPrincipal === 0n) continue; // nothing held here after the plan
      if (BAND_RANK[r.band] > BAND_RANK[worst]) worst = r.band;
      const posUsd = Number(v.allocatedPrincipal) / unit;
      // Genuine trap tests: the shock pushes the venue to the TOP band, or our position exceeds all
      // withdrawable liquidity under the shock (we literally could not get out in one move).
      const bandTrap = r.band === "high";
      const exitTrap = v.liquidityUsd > 0 ? posUsd > v.liquidityUsd : posUsd > 0;
      if (bandTrap || exitTrap) {
        breaches.push(v.name);
        fragile.add(v.address.toLowerCase());
        fragileNames.add(v.name);
      }
    }
    scenarios.push({ name: sc.name, worstBand: worst, breaches });
  }

  const breachCount = scenarios.filter((s) => s.breaches.length > 0).length;
  const fragility = clamp01(breachCount / SCENARIOS.length);
  const recommendedRegime: Regime =
    fragility > 0.66 ? "defensive" : fragility > 0.33 ? "cautious" : "calm";
  const notes: string[] = [];
  if (fragileNames.size)
    notes.push(`fragile under stress: ${[...fragileNames].join(", ")} — denied new deploys`);
  if (recommendedRegime !== "calm")
    notes.push(`stress recommends a ${recommendedRegime} regime`);

  return {
    fragile: [...fragile],
    fragileNames: [...fragileNames],
    recommendedRegime,
    fragility,
    scenarios,
    notes,
  };
}
