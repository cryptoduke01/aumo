import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Config } from "./config.js";
import { buildIdentity } from "./identity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECEIPTS = join(__dirname, "..", "receipts", "decisions.jsonl");

function readRecent(limit: number): unknown[] {
  if (!existsSync(RECEIPTS)) return [];
  const raw = readFileSync(RECEIPTS, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .slice(-limit)
    .map((l) => JSON.parse(l))
    .reverse();
}

interface Decision {
  takenAt?: string;
  policyFingerprint?: string;
  plan?: {
    summary?: string;
    source?: string;
    regime?: string;
    appetite?: string;
    moves?: Array<Record<string, unknown>>;
    risks?: Array<Record<string, unknown>>;
  };
  snapshot?: {
    vault?: { idle?: string; totalDeployed?: string; symbol?: string; decimals?: number };
    venues?: Array<Record<string, unknown>>;
  };
}

/** Compact, model-friendly view of the agent's current state for Q&A grounding. */
function buildContext(cfg: Config) {
  const recent = readRecent(4) as Decision[];
  const latest = recent[0];
  const dec = latest?.snapshot?.vault?.decimals ?? 6;
  const u = (v: unknown) => (v == null ? null : Number(v) / 10 ** dec);
  return {
    identity: buildIdentity(cfg),
    latest: latest
      ? {
          takenAt: latest.takenAt,
          regime: latest.plan?.regime,
          appetite: latest.plan?.appetite,
          source: latest.plan?.source,
          summary: latest.plan?.summary,
          idle: u(latest.snapshot?.vault?.idle),
          deployed: u(latest.snapshot?.vault?.totalDeployed),
          moves: latest.plan?.moves ?? [],
          venues: (latest.plan?.risks ?? []).map((r) => ({
            name: r.name,
            apyPct: typeof r.apyBps === "number" ? r.apyBps / 100 : null,
            riskAdjPct:
              typeof r.riskAdjustedApyBps === "number" ? r.riskAdjustedApyBps / 100 : null,
            band: r.band,
            notes: r.notes,
          })),
        }
      : null,
    recentDecisions: recent.slice(1).map((r) => ({ takenAt: r.takenAt, summary: r.plan?.summary })),
  };
}

const ASK_SYSTEM = `You are Aumo, an autonomous treasury agent for stablecoins on X Layer. You put idle USDT0 to work in on-chain yield within strict, on-chain guardrails, and you prove every move.

Answer the user's question about YOUR decisions, venues, risk scoring, guardrails, and strategy, speaking in the first person as the agent. Ground every answer ONLY in the state provided to you; if the state does not contain the answer, say so plainly. Be concise: 2 to 4 sentences, plain language, no hype. Never give financial or investment advice, never predict prices, and never claim to do anything outside your on-chain guardrails. If asked to do something you cannot (move funds off-chain, exceed a cap), explain that you cannot.`;

const rate = new Map<string, number[]>(); // ip -> recent request timestamps
function rateLimited(ip: string, now: number): boolean {
  const hits = (rate.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 12) return true; // 12 questions / minute / ip
  hits.push(now);
  rate.set(ip, hits);
  return false;
}

function readBody(req: IncomingMessage, cap = 4_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > cap) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function askAgent(cfg: Config, question: string): Promise<string> {
  if (!cfg.anthropicKey) return "My reasoning layer is offline right now, so I can only answer through the dashboard. Try again shortly.";
  const context = buildContext(cfg);
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: cfg.anthropicKey });
  const msg = await client.messages.create({
    model: cfg.model,
    max_tokens: 400,
    system: ASK_SYSTEM,
    messages: [
      {
        role: "user",
        content: `My current state:\n\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${question}`,
      },
    ],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
}

/**
 * Read-only status surface plus an interactive Q&A endpoint. Makes the living
 * agent both observable (identity, receipts) and conversational (/ask), grounded
 * in its own on-chain state.
 */
export function startServer(cfg: Config) {
  const port = Number(process.env.PORT ?? 8080);
  const identity = buildIdentity(cfg);

  const cors = (res: ServerResponse) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("content-type", "application/json");
    cors(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/ask" && req.method === "POST") {
      const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.socket.remoteAddress || "?").trim();
      if (rateLimited(ip, Date.now())) {
        res.statusCode = 429;
        res.end(JSON.stringify({ error: "Too many questions. Give me a moment." }));
        return;
      }
      try {
        const body = await readBody(req);
        const question = String(JSON.parse(body || "{}").question ?? "").trim().slice(0, 500);
        if (!question) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Ask me something." }));
          return;
        }
        const answer = await askAgent(cfg, question);
        res.end(JSON.stringify({ answer }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "ask failed" }));
      }
      return;
    }

    if (url.pathname === "/receipts") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
      res.end(JSON.stringify(readRecent(limit), null, 2));
      return;
    }

    const latest = readRecent(1)[0] as Decision | undefined;
    const vault = latest?.snapshot?.vault;
    res.end(
      JSON.stringify(
        {
          agent: identity,
          latest: latest
            ? {
                takenAt: latest.takenAt,
                policyFingerprint: latest.policyFingerprint,
                source: latest.plan?.source,
                summary: latest.plan?.summary,
                idle: vault?.idle,
                deployed: vault?.totalDeployed,
                symbol: vault?.symbol,
                moves: latest.plan?.moves ?? [],
              }
            : null,
        },
        null,
        2,
      ),
    );
  });

  server.listen(port, () => console.log(`Aumo status server listening on :${port}`));
  return server;
}
