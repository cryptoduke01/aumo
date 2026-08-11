import { z } from "zod";
import type { Config } from "../config.js";
import type { MarketSnapshot, Regime } from "../types.js";
import { buildPlan, type Plan } from "./plan.js";
import { extractJson } from "./reason.js";
import { computeMomentum } from "../risk/momentum.js";
import { PANEL_SYSTEM } from "./prompt.js";

/**
 * The collective layer. Instead of one generalist model, Aumo convenes a PANEL of specialist agents,
 * each reasoning over only its slice of the world with a narrow mandate: a peg watcher, a liquidity
 * analyst, and a macro strategist. Their outputs are synthesized DETERMINISTICALLY and tighten-only:
 * vetoes are unioned, the regime is the most defensive anyone proposes, and nothing a specialist
 * says can loosen a guardrail. Distinct perspectives catch what a single reasoner misses; the
 * deterministic merge keeps the safety guarantee. Every specialist's verdict is written to the
 * receipt, so the panel is fully auditable.
 */

const REGIME_RANK: Record<Regime, number> = { defensive: 0, cautious: 1, calm: 2 };

const Verdict = z.object({
  concern: z.number().min(0).max(1).default(0),
  vetoes: z.array(z.string()).default([]),
  regime: z.enum(["calm", "cautious", "defensive"]).optional(),
  note: z.string().default(""),
});
type VerdictT = z.infer<typeof Verdict>;

export interface RoleVerdict extends VerdictT {
  role: string;
  ok: boolean; // false when the specialist abstained (model unavailable) — abstaining never loosens
}

export interface PanelResult {
  regime: Regime;
  vetoes: string[];
  verdicts: RoleVerdict[];
}

/** Per-specialist focused data view. Each agent sees ONLY what its mandate needs. */
function pegView(snap: MarketSnapshot) {
  return {
    venues: snap.venues.map((v) => {
      const t = computeMomentum(
        { utilization: v.utilization, pegDeviationBps: v.pegDeviationBps, liquidityUsd: v.liquidityUsd, tvlUsd: v.tvlUsd, apyBps: v.apyBps },
        snap.history?.[v.address.toLowerCase()],
      );
      return {
        address: v.address,
        name: v.name,
        kind: v.kind,
        pegDeviationBps: v.pegDeviationBps,
        pegMonitored: v.pegVerified ?? false,
        held: v.allocatedPrincipal > 0n,
        pegTrend: t.pegDeltaBps > 15 ? `widening +${Math.round(t.pegDeltaBps)}bps` : "stable",
      };
    }),
  };
}

function liquidityView(snap: MarketSnapshot) {
  const unit = 10 ** snap.vault.decimals;
  return {
    venues: snap.venues.map((v) => ({
      address: v.address,
      name: v.name,
      kind: v.kind,
      tvlUsd: v.tvlUsd,
      withdrawableUsd: v.liquidityUsd,
      ourPositionUsd: Number(v.allocatedPrincipal) / unit,
      depthPctOfTvl: v.tvlUsd > 0 ? Math.round((v.liquidityUsd / v.tvlUsd) * 100) : 0,
    })),
  };
}

function macroView(snap: MarketSnapshot, base: Plan) {
  const unit = 10 ** snap.vault.decimals;
  return {
    idle: Number(snap.vault.idle) / unit,
    deployed: Number(snap.vault.totalDeployed) / unit,
    engineRegime: base.regime,
    venues: snap.venues.map((v) => {
      const r = base.risks.find((x) => x.address.toLowerCase() === v.address.toLowerCase());
      return {
        name: v.name,
        kind: v.kind,
        apyPct: v.apyBps / 100,
        utilization: v.utilization,
        band: r?.band ?? "n/a",
        momentumRisk: r ? Number(r.momentumRisk.toFixed(2)) : 0,
      };
    }),
  };
}

async function consult(cfg: Config, role: string, view: unknown): Promise<RoleVerdict> {
  const abstain: RoleVerdict = { role, ok: false, concern: 0, vetoes: [], note: "abstained" };
  if (!cfg.anthropicKey) return abstain;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: cfg.anthropicKey });
    const msg = await client.messages.create({
      model: cfg.model,
      max_tokens: 400,
      system: PANEL_SYSTEM[role as keyof typeof PANEL_SYSTEM],
      messages: [{ role: "user", content: `${JSON.stringify(view, null, 2)}\n\nRespond with the JSON object only.` }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const parsed = Verdict.parse(JSON.parse(extractJson(text)));
    return { role, ok: true, ...parsed };
  } catch {
    return abstain; // an abstaining specialist never loosens the plan
  }
}

/**
 * Convene the panel and return the tightened plan. baseDeny (e.g. the stress test's fragile venues)
 * is preserved. Mirrors reason()'s signature so it slots into the pipeline in the same place.
 */
export async function convenePanel(
  snap: MarketSnapshot,
  base: Plan,
  cfg: Config,
  baseDeny: Set<string> = new Set(),
): Promise<Plan> {
  // No model or an idle vault: fall back to the deterministic base (already stress-constrained).
  if (!cfg.anthropicKey || snap.vault.idle + snap.vault.totalDeployed === 0n) {
    return { ...base, source: "risk-engine" };
  }

  const [peg, liquidity, macro] = await Promise.all([
    consult(cfg, "peg", pegView(snap)),
    consult(cfg, "liquidity", liquidityView(snap)),
    consult(cfg, "macro", macroView(snap, base)),
  ]);
  return synthesizePanel(snap, base, [peg, liquidity, macro], baseDeny, cfg.maxConcentration);
}

/**
 * Deterministic, tighten-only merge of the panel's verdicts into a plan. Pure and testable: vetoes
 * are unioned (hallucinated addresses ignored), the regime is the most defensive anyone proposes and
 * can never be looser than the engine's, and an abstaining specialist contributes nothing. Nothing
 * here can loosen the plan.
 */
export function synthesizePanel(
  snap: MarketSnapshot,
  base: Plan,
  verdicts: RoleVerdict[],
  baseDeny: Set<string>,
  maxConcentration: number,
): Plan {
  const known = new Set(snap.venues.map((v) => v.address.toLowerCase()));
  const vetoes = new Set<string>(baseDeny);
  for (const v of verdicts) {
    for (const a of v.vetoes) {
      const low = a.toLowerCase();
      if (known.has(low)) vetoes.add(low); // ignore hallucinated / unknown addresses
    }
  }
  let regime: Regime = base.regime;
  for (const v of verdicts) {
    if (v.regime && REGIME_RANK[v.regime] < REGIME_RANK[regime]) regime = v.regime;
  }

  const tightened = buildPlan(snap, {
    appetite: base.appetite,
    regime,
    maxConcentration,
    deny: vetoes,
  });

  const panel: PanelResult = { regime, vetoes: [...vetoes], verdicts };
  const notes = verdicts
    .filter((v) => v.ok && v.note)
    .map((v) => `${v.role[0]!.toUpperCase() + v.role.slice(1)}: ${v.note}`)
    .join(" ");

  return {
    ...tightened,
    stress: base.stress,
    reflection: base.reflection,
    panel,
    source: "risk-engine+panel",
    summary: notes ? `${tightened.summary} ${notes}` : tightened.summary,
  };
}
