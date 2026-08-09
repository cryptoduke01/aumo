import { z } from "zod";
import type { Config } from "../config.js";
import type { MarketSnapshot, Regime, RiskBand } from "../types.js";
import { buildPlan, type Plan } from "./plan.js";
import { SYSTEM_PROMPT } from "./prompt.js";  

const REGIME_RANK: Record<Regime, number> = { defensive: 0, cautious: 1, calm: 2 };
const BAND_RANK: Record<RiskBand, number> = { low: 0, moderate: 1, elevated: 2, high: 3 };

export const LlmReply = z.object({
  regime: z.enum(["calm", "cautious", "defensive"]),
  appetite: z.enum(["low", "moderate", "elevated"]),
  veto: z.array(z.string()).default([]),
  narrative: z.string().min(1),
});
export type LlmReplyT = z.infer<typeof LlmReply>;

/**
 * The safety kernel of the reasoning layer, extracted pure so it can be tested
 * without the network. The model's choices are folded against the engine's so the
 * result is never looser: regime moves only toward defensive, appetite only toward
 * low, and vetoes only ever remove venues.
 */
export function resolveTighten(
  base: { regime: Regime; appetite: RiskBand },
  reply: { regime: Regime; appetite: RiskBand; veto: string[] },
): { regime: Regime; appetite: RiskBand; deny: Set<string> } {
  const regime: Regime =
    REGIME_RANK[reply.regime] < REGIME_RANK[base.regime] ? reply.regime : base.regime;
  const appetite: RiskBand =
    BAND_RANK[reply.appetite] < BAND_RANK[base.appetite] ? reply.appetite : base.appetite;
  const deny = new Set(reply.veto.map((a) => a.toLowerCase()));
  return { regime, appetite, deny };
}

/** Pull the first JSON object out of a model reply that may include prose or fences. */
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end < start) throw new Error("no JSON object in model reply");
  return text.slice(start, end + 1);
}

function modelView(snap: MarketSnapshot, base: Plan) {
  const dec = snap.vault.decimals;
  const f = (x: bigint) => (Number(x) / 10 ** dec).toFixed(2);
  return {
    vault: {
      asset: snap.vault.symbol,
      idle: f(snap.vault.idle),
      totalDeployed: f(snap.vault.totalDeployed),
      caps: {
        maxMove: f(snap.vault.maxMoveSize),
        perVenue: f(snap.vault.perVenueCap),
        maxTotal: f(snap.vault.maxTotalDeployed),
      },
      paused: snap.vault.paused,
    },
    enginePlan: {
      regime: base.regime,
      appetite: base.appetite,
      summary: base.summary,
      moves: base.moves.map((m) => ({
        action: m.action,
        venue: m.venueName,
        amount: f(m.amount),
        band: m.band,
      })),
    },
    venues: snap.venues.map((v) => {
      const r = base.risks.find((x) => x.address.toLowerCase() === v.address.toLowerCase());
      return {
        address: v.address,
        name: v.name,
        kind: v.kind,
        apyPct: (v.apyBps / 100).toFixed(2),
        tvlUsd: v.tvlUsd,
        liquidityUsd: v.liquidityUsd,
        utilization: v.utilization,
        pegDeviationBps: v.pegDeviationBps,
        allowedOnChain: v.allowed,
        currentPrincipal: f(v.allocatedPrincipal),
        risk: r
          ? {
              score: Number(r.riskScore.toFixed(3)),
              band: r.band,
              riskAdjustedApyPct: (r.riskAdjustedApyBps / 100).toFixed(2),
              notes: r.notes,
            }
          : null,
      };
    }),
  };
}

/**
 * Wrap the deterministic plan with the LLM judgment layer. The model can only make
 * the plan more conservative; the result is rebuilt through buildPlan() so every
 * guardrail is re-enforced in code regardless of what the model said.
 */
// Cross-tick cache so a quiet market does not re-bill the model every tick.
let lastKey: string | null = null;
let lastReply: LlmReplyT | null = null;

/** Material inputs that would change the model's judgment. */
function stateKey(snap: MarketSnapshot, base: Plan): string {
  return JSON.stringify({
    idle: snap.vault.idle.toString(),
    deployed: snap.vault.totalDeployed.toString(),
    paused: snap.vault.paused,
    venues: snap.venues.map((v) => [
      v.address,
      v.apyBps,
      Math.round(v.utilization * 100),
      v.pegDeviationBps,
      v.allowed,
    ]),
    moves: base.moves.map((m) => [m.action, m.venueName, m.amount.toString()]),
  });
}

export async function reason(snap: MarketSnapshot, base: Plan, cfg: Config): Promise<Plan> {
  if (!cfg.anthropicKey) {
    return { ...base, summary: `${base.summary} (deterministic risk engine; no LLM key set)` };
  }

  // Do not spend model credits when there is nothing to manage: an empty vault
  // (no depositors) has a trivial "hold" plan the model cannot improve on.
  if (snap.vault.idle + snap.vault.totalDeployed === 0n) {
    return { ...base, summary: `${base.summary} (idle vault; reasoning skipped to conserve credits)` };
  }

  // Reuse the last judgment when the material state has not changed, so a quiet
  // market does not re-bill the model on every tick.
  const key = stateKey(snap, base);
  let reply: z.infer<typeof LlmReply>;
  if (key === lastKey && lastReply) {
    reply = lastReply;
  } else {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: cfg.anthropicKey });
      const msg = await client.messages.create({
        model: cfg.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Current state and the risk engine's candidate plan:\n\n${JSON.stringify(
              modelView(snap, base),
              null,
              2,
            )}\n\nRespond with the JSON object only.`,
          },
        ],
      });
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      reply = LlmReply.parse(JSON.parse(extractJson(text)));
      lastKey = key;
      lastReply = reply;
    } catch (err) {
      // Any failure (no network, bad JSON, timeout) falls back to the safe core.
      return {
        ...base,
        summary: `${base.summary} (LLM layer unavailable: ${
          err instanceof Error ? err.message : "error"
        }; using deterministic risk engine)`,
      };
    }
  }

  // Enforce tighten-only: pick the more conservative of engine vs model.
  const { regime, appetite, deny } = resolveTighten(base, reply);

  const tightened = buildPlan(snap, {
    appetite,
    regime,
    maxConcentration: cfg.maxConcentration,
    deny,
  });

  return {
    ...tightened,
    source: "risk-engine+llm",
    summary: reply.narrative.trim(),
  };
}
