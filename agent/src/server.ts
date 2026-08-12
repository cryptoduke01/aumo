import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPublicClient, http, isAddress, type Address } from "viem";
import type { Config } from "./config.js";
import { buildIdentity } from "./identity.js";
import { makeChain } from "./chain/client.js";
import { readDepositorPosition } from "./chain/vault.js";
import { RECEIPTS_FILE } from "./act/receipts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Same env-resolved path the writer uses (RECEIPTS_DIR), so a persistent volume is read back correctly.
const RECEIPTS = RECEIPTS_FILE;

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
    vault?: {
      address?: string;
      idle?: string;
      totalDeployed?: string;
      symbol?: string;
      decimals?: number;
    };
    venues?: Array<Record<string, unknown>>;
  };
}

/** Compact, model-friendly view of the agent's current state for Q&A grounding. */
function buildContext(cfg: Config) {
  const recent = readRecent(6) as Decision[];
  const latest = recent[0];
  const dec = latest?.snapshot?.vault?.decimals ?? 6;
  const u = (v: unknown) => (v == null ? null : Number(v) / 10 ** dec);
  // Join the latest risk scores (by venue name) onto the live on-chain venue positions, so the agent
  // can answer "how much is in each venue", "which holds the most", and "are they allowed" — not just
  // recite scores. Sorted by current principal so the model sees the biggest position first.
  const risksByName = new Map(
    (latest?.plan?.risks ?? []).map((r) => [String(r.name), r]),
  );
  const venues = (latest?.snapshot?.venues ?? [])
    .map((v) => {
      const r = risksByName.get(String(v.name));
      return {
        name: v.name,
        allowed: v.allowed ?? null,
        deployed: u(v.allocatedPrincipal),
        currentValue: u(v.liveBalance),
        apyPct: r && typeof r.apyBps === "number" ? r.apyBps / 100 : null,
        riskAdjPct:
          r && typeof r.riskAdjustedApyBps === "number" ? r.riskAdjustedApyBps / 100 : null,
        band: r?.band ?? null,
        notes: r?.notes ?? null,
      };
    })
    .sort((a, b) => (b.deployed ?? 0) - (a.deployed ?? 0));
  const mostDeployed = venues.find((v) => (v.deployed ?? 0) > 0)?.name ?? null;
  return {
    identity: buildIdentity(cfg),
    latest: latest
      ? {
          takenAt: latest.takenAt,
          vault: latest.snapshot?.vault?.address ?? null,
          regime: latest.plan?.regime,
          appetite: latest.plan?.appetite,
          source: latest.plan?.source,
          summary: latest.plan?.summary,
          idle: u(latest.snapshot?.vault?.idle),
          deployed: u(latest.snapshot?.vault?.totalDeployed),
          mostDeployedVenue: mostDeployed,
          moves: latest.plan?.moves ?? [],
          venues,
        }
      : null,
    recentDecisions: recent.slice(1).map((r) => ({ takenAt: r.takenAt, summary: r.plan?.summary })),
    strategy: strategyFor(cfg.chainId),
  };
}

// Stable description of what Aumo is and how it earns — so the agent can answer product/strategy
// questions ("where does the yield come from?", "would you use Aave?") confidently and correctly,
// even when the live snapshot only holds the current (mock, on testnet) venues. Live numbers still
// come from `latest`; this is the durable "who I am and how I work" context.
const STRATEGY = {
  whatItIs:
    "Aumo is an autonomous agent that puts idle stablecoins (USDT0) to work in the best risk-adjusted on-chain yield, inside guardrails enforced by the contract. Deposit USDT0, receive pool shares, and the agent allocates the pooled balance across approved venues and back.",
  whereYieldComesFrom:
    "USDT0 keeps its 1:1 peg, so profit is not price appreciation. It is the interest the venues pay: on-chain lending yield plus the yield on a Treasury-backed dollar. Aumo turns idle stablecoins into earning assets without the user hunting yield or managing risk by hand.",
  mainnetVenues: [
    "Aave v3 on X Layer — supplying USDT0 for lending interest",
    "USDG — a tokenized, Treasury-backed dollar (a real-world asset), for RWA yield",
    "Pendle PT-USDG — buying the Principal Token to lock in a FIXED yield on USDG to maturity",
  ],
  testnetNote:
    "On X Layer testnet there is no real DeFi, so the current venues (MockYield, StableVault) are mock stand-ins with illustrative metrics that let the risk engine choose between them. On mainnet they are the real adapters above.",
  howItScores:
    "Each venue's APY is haircut by protocol, liquidity, peg, utilization, and concentration risk into one risk-adjusted score. Aumo does not chase raw APY; it can only ever tighten toward safety.",
};

// On mainnet the venues are the real adapters, so the testnet "these are mocks" note must NOT reach
// the model — it would otherwise tell a live depositor the pool holds MockYield/StableVault. Strip it.
function strategyFor(chainId: number) {
  if (chainId !== 196) return STRATEGY; // testnet: keep the mock-venues note
  const { whatItIs, whereYieldComesFrom, mainnetVenues, howItScores } = STRATEGY;
  return { whatItIs, whereYieldComesFrom, mainnetVenues, howItScores };
}

const ASK_SYSTEM = `You are Aumo, an autonomous treasury agent for stablecoins on X Layer. You put idle USDT0 to work in on-chain yield within strict, on-chain guardrails, and you prove every move. Speak in the first person as the agent.

Three kinds of question, three sources of truth:
- Product / strategy / "how do you work" / "where does yield come from" / "what would you use on mainnet": answer from the STRATEGY block. You DO know your strategy — explain it confidently. When on testnet, be honest that the current venues are mock stand-ins, but still explain what the real mainnet venues (Aave v3, USDG) are.
- Live specifics — pool holdings, per-venue allocations, the latest decision: ground these in the "latest" state. If a specific number genuinely is not in the state, say so plainly rather than inventing it.
- The person's OWN position — "what's mine?", "my share", "what am I earning": if a "you" block is present, it is the connected wallet read live on-chain. Answer directly from it — "redeemable" is their position in USDT0 (including accrued yield), "sharePct" is their percent of the pool, and "yourVenues" is their pro-rata slice of each venue. If "you.isDepositor" is false, tell them this wallet hasn't deposited yet. If there is NO "you" block at all, say you can't see their wallet from here and to connect a wallet / open the "My position" view — do not guess.

Rules: be concise (2 to 4 sentences), plain language, no hype. Do not leak internal field names or JSON keys (say "not yet approved for allocation", never "allowedOnChain: false"). Never give financial or investment advice, never predict prices, never claim to act outside your on-chain guardrails. If asked to do something you cannot (move funds off-chain, exceed a cap), explain plainly that you cannot and why.`;

/**
 * Resolve the client IP for rate-limiting. `X-Forwarded-For` is a client-writable header of the form
 * `client, proxy1, proxy2`; a trusted reverse proxy APPENDS the peer it saw, so the entry it added is
 * the RIGHTMOST one. Reading the leftmost token (the old behaviour) let a caller prepend a random
 * fake IP on every request and never trip the limiter — an unauthenticated way to drive unbounded
 * LLM calls (cost/DoS). Trust only the rightmost forwarded entry, and fall back to the socket peer
 * when there is no proxy header. Set TRUST_PROXY_HOPS>1 if several proxies are chained; a misconfig
 * then fails safe (over-restrictive), never open. (F-3)
 */
function clientIp(req: IncomingMessage): string {
  const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS ?? 1));
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const parts = xff.toString().split(",").map((s) => s.trim()).filter(Boolean);
    const picked = parts[Math.max(0, parts.length - hops)];
    if (picked) return picked;
  }
  return (req.socket.remoteAddress || "?").trim();
}

const rate = new Map<string, number[]>(); // ip -> recent request timestamps
function rateLimited(ip: string, now: number): boolean {
  const hits = (rate.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= 12) return true; // 12 questions / minute / ip
  hits.push(now);
  rate.set(ip, hits);
  return false;
}

// --- /ask cost controls ---------------------------------------------------------------------------
// Under a traffic spike (a teaser, a viral post) the same handful of questions repeat, and the agent's
// answer only changes when its state changes — once per tick. So we cache identical GENERIC questions
// per state-version and serve most requests without touching the model; we cap total model calls per
// day as a hard circuit-breaker; and we let /ask run a cheaper model than the money-path reasoning.
const ASK_MODEL = process.env.ASK_MODEL || undefined; // e.g. claude-haiku-4-5-20251001; else cfg.model
const ASK_CACHE_TTL = Number(process.env.ASK_CACHE_TTL_MS ?? 5 * 60_000);
const ASK_DAILY_CAP = Number(process.env.ASK_DAILY_CAP ?? 3000); // model calls per day
const ASK_CACHE_MAX = 1000;
const askCache = new Map<string, { answer: string; at: number }>();
let askCalls = { day: -1, count: 0 };

function askOverBudget(now: number): boolean {
  const day = Math.floor(now / 86_400_000);
  if (day !== askCalls.day) askCalls = { day, count: 0 };
  return askCalls.count >= ASK_DAILY_CAP;
}
// The agent's state version — its latest receipt timestamp. When a new tick lands, the version
// changes and every cached answer is naturally invalidated.
function stateVersion(): string {
  const latest = readRecent(1)[0] as Decision | undefined;
  return latest?.takenAt ?? "none";
}
const normQ = (q: string): string => q.toLowerCase().replace(/\s+/g, " ").trim();

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

/**
 * The connected wallet's own stake, read live on-chain — so "what's my position?" gets a real answer
 * grounded in the same maxWithdraw the dashboard shows, with each venue sliced pro-rata by share.
 * Pool share balances are public on-chain, so this leaks nothing the explorer doesn't already.
 */
async function readYou(cfg: Config, address: Address, context: ReturnType<typeof buildContext>) {
  try {
    const pc = createPublicClient({ chain: makeChain(cfg), transport: http(cfg.rpcUrl) });
    const pos = await readDepositorPosition(pc, cfg.vaultAddress as Address, address);
    const toN = (v: bigint) => Number(v) / 1e6; // pool asset is 6dp (USDT0)
    if (pos.shares === 0n) {
      return { address, isDepositor: false, note: "This wallet holds no pool shares — it has not deposited." };
    }
    const venues = (context.latest?.venues ?? [])
      .filter((v) => (v.currentValue ?? 0) > 0)
      .map((v) => ({ name: v.name, yourValue: Number(((v.currentValue ?? 0) * pos.sharePct).toFixed(2)) }));
    return {
      address,
      isDepositor: true,
      redeemable: Number(toN(pos.redeemable).toFixed(2)),
      sharePct: Number((pos.sharePct * 100).toFixed(2)),
      yourVenues: venues,
    };
  } catch {
    return null; // read failed — omit the block rather than block the answer
  }
}

async function askAgent(cfg: Config, question: string, address?: string): Promise<string> {
  if (!cfg.anthropicKey) return "My reasoning layer is offline right now, so I can only answer through the dashboard. Try again shortly.";
  const now = Date.now();

  // Cache only GENERIC (no-wallet) questions. A depositor's own position can change between ticks
  // (they just deposited), so wallet-scoped answers must never be served stale.
  const cacheable = !(address && isAddress(address));
  const key = cacheable ? `${stateVersion()}|${normQ(question)}` : "";
  if (cacheable) {
    const hit = askCache.get(key);
    if (hit && now - hit.at < ASK_CACHE_TTL) return hit.answer; // free: no model call
  }
  if (askOverBudget(now)) {
    return "I'm fielding a lot of questions right now. Give me a minute and ask again, or explore the dashboard in the meantime.";
  }

  const context = buildContext(cfg);
  const you = address && isAddress(address) ? await readYou(cfg, address as Address, context) : null;
  const grounding = you ? { ...context, you } : context;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: cfg.anthropicKey });
  askCalls.count++;
  const msg = await client.messages.create({
    model: ASK_MODEL ?? cfg.model, // /ask can run a cheaper model than the money-path reasoning
    max_tokens: 400,
    system: ASK_SYSTEM,
    messages: [
      {
        role: "user",
        content: `My current state:\n\n${JSON.stringify(grounding, null, 2)}\n\nQuestion: ${question}`,
      },
    ],
  });
  const answer = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
  if (cacheable && answer) {
    if (askCache.size >= ASK_CACHE_MAX) askCache.delete(askCache.keys().next().value!); // evict oldest
    askCache.set(key, { answer, at: now });
  }
  return answer;
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
      const ip = clientIp(req);
      if (rateLimited(ip, Date.now())) {
        res.statusCode = 429;
        res.end(JSON.stringify({ error: "Too many questions. Give me a moment." }));
        return;
      }
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body || "{}");
        const question = String(parsed.question ?? "").trim().slice(0, 500);
        // Optional: the connected wallet, so the agent can answer "what's my position?" from live
        // on-chain shares. Public data; ignored if malformed.
        const address = typeof parsed.address === "string" ? parsed.address.trim() : undefined;
        if (!question) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Ask me something." }));
          return;
        }
        const answer = await askAgent(cfg, question, address);
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
