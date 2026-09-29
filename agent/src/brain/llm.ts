import type { Config } from "../config.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** True when any LLM provider is configured. Groq is preferred (cheaper/free), else Anthropic. */
export function llmConfigured(cfg: Config): boolean {
  return Boolean(cfg.groqKey || cfg.anthropicKey);
}

/**
 * Provider-agnostic single-shot chat call for the reasoning layer, the specialist panel, and /ask.
 * When GROQ_API_KEY is set it hits Groq's OpenAI-compatible endpoint over fetch (no SDK, no new
 * dependency); otherwise it uses the Anthropic SDK. Returns the raw assistant text; callers parse the
 * JSON out as before, so the guardrails (tighten-only, re-built through buildPlan) are unchanged
 * regardless of which model produced the reply. `model` overrides cfg.model (used by /ask for a
 * cheaper model). Any failure throws, and every caller already falls back to the deterministic core.
 */
// Groq rate-limits each model separately (tokens per day, per minute). When the requested model is
// capped, unavailable or erroring, the call walks this chain of other models before giving up, so one
// model's exhausted daily budget no longer silences the agent. Override with GROQ_FALLBACK_MODELS.
const GROQ_FALLBACKS = (process.env.GROQ_FALLBACK_MODELS ?? "openai/gpt-oss-20b,llama-3.3-70b-versatile,llama-3.1-8b-instant")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Statuses worth retrying on another model: rate or size limits, a missing/decommissioned model, and
// provider-side failures. Anything else (bad auth) fails the same way on every model.
const RETRY_ON_NEXT = new Set([400, 404, 413, 429, 500, 502, 503, 504]);

export async function callModel(
  cfg: Config,
  opts: { system: string; user: string; maxTokens?: number; model?: string; reasoningEffort?: "low" | "medium" | "high" },
): Promise<string> {
  const model = opts.model ?? cfg.model;
  const maxTokens = opts.maxTokens ?? 1024;

  if (cfg.groqKey) {
    const chain = [model, ...GROQ_FALLBACKS.filter((m) => m !== model)];
    let lastErr = "";
    for (const m of chain) {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.groqKey}` },
        body: JSON.stringify({
          model: m,
          max_tokens: maxTokens,
          temperature: 0.2,
          // gpt-oss spends max_tokens on reasoning first; callers that want a short answer ask for less.
          ...(opts.reasoningEffort && m.startsWith("openai/gpt-oss") ? { reasoning_effort: opts.reasoningEffort } : {}),
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return j.choices?.[0]?.message?.content ?? "";
      }
      lastErr = `groq ${res.status} (${m}): ${(await res.text()).slice(0, 200)}`;
      if (!RETRY_ON_NEXT.has(res.status)) break;
    }
    throw new Error(lastErr);
  }

  if (!cfg.anthropicKey) throw new Error("no LLM provider configured (set GROQ_API_KEY or ANTHROPIC_API_KEY)");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: cfg.anthropicKey });
  const msg = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
}
