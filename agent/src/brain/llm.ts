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
export async function callModel(
  cfg: Config,
  opts: { system: string; user: string; maxTokens?: number; model?: string },
): Promise<string> {
  const model = opts.model ?? cfg.model;
  const maxTokens = opts.maxTokens ?? 1024;

  if (cfg.groqKey) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.groqKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? "";
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
