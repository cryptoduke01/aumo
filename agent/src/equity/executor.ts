import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  stringToHex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { equityPoolAbi } from "./abi.js";
import { erc20Abi } from "../chain/abi.js";
import { loadEquityConfig, type EquityConfig } from "./config.js";
import type { Address } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECEIPTS = join(__dirname, "..", "..", "receipts", "equity.jsonl");

function chainOf(cfg: EquityConfig) {
  return defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

interface Clients {
  pc: PublicClient;
  wallet?: WalletClient;
  agentAddr?: Address;
}

function clients(cfg: EquityConfig): Clients {
  const chain = chainOf(cfg);
  const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  if (!cfg.agentPrivateKey) return { pc };
  const account = privateKeyToAccount(cfg.agentPrivateKey);
  const wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  return { pc, wallet, agentAddr: account.address };
}

const fmt = (x: bigint, dec: number) =>
  (Number(x) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The on-chain state the deploy decision depends on. Kept separate so the decision is pure/testable. */
export interface EquityPoolView {
  allowed: boolean;
  paused: boolean;
  marketOpen: boolean;
  idle: bigint;
  exposure: bigint; // max(principal, live value) in the venue — the pool's own cap basis
  totalDeployed: bigint;
  maxMove: bigint;
  perVenueCap: bigint;
  maxTotal: bigint;
}

/**
 * How much idle to deploy this cycle, mirroring the pool's own guardrails so we never send a doomed
 * tx. Deploy only when the venue is allowlisted, the pool is unpaused, and the market is open; then
 * take the smallest of idle, the per-move cap, and the remaining per-venue / total headroom (both on
 * the max(principal, live) exposure basis the contract enforces). Returns 0 with a reason otherwise.
 */
export function computeDeployable(v: EquityPoolView): { deployable: bigint; reason: string } {
  if (!v.allowed) return { deployable: 0n, reason: "venue not allowlisted on the equity pool" };
  if (v.paused) return { deployable: 0n, reason: "pool paused" };
  if (!v.marketOpen)
    return { deployable: 0n, reason: "market closed (stale clock) — holding; entry/exit frozen by the pool" };
  if (v.idle === 0n) return { deployable: 0n, reason: "no idle USD₮0 to deploy" };

  const venueHeadroom = v.perVenueCap > v.exposure ? v.perVenueCap - v.exposure : 0n;
  const totalHeadroom = v.maxTotal > v.totalDeployed ? v.maxTotal - v.totalDeployed : 0n;
  let deployable = v.idle;
  if (deployable > v.maxMove) deployable = v.maxMove;
  if (deployable > venueHeadroom) deployable = venueHeadroom;
  if (deployable > totalHeadroom) deployable = totalHeadroom;
  return {
    deployable,
    reason: deployable > 0n ? "deploy idle within caps (market open)" : "caps leave no headroom this cycle",
  };
}

/** What the executor sees and decides in one cycle. */
export interface EquityDecision {
  at: string;
  marketOpen: boolean;
  paused: boolean;
  idle: bigint;
  exposure: bigint; // max(principal, live value) in the venue
  totalDeployed: bigint;
  nav: bigint; // pool totalAssets
  deployable: bigint; // amount we'd allocate this cycle (0 = hold)
  reason: string;
  action: "allocate" | "hold";
  hash?: string;
  status?: "confirmed" | "reverted" | "error";
  error?: string;
}

/**
 * One equity cycle. The executor's ENTIRE job: if the market is open and the pool holds idle USD₮0,
 * deploy it into the single allowlisted xStock venue, within the pool's own caps. It does NOT score
 * yield, pick stocks, or reason over a panel — the depositor chose the exposure by depositing, and
 * the contract re-checks every guardrail. Normal exits are depositor redemptions; the executor never
 * force-sells. When the market is closed it holds (the pool already blocks entry/exit anyway).
 */
export async function equityTick(cfg: EquityConfig, opts: { dryRun?: boolean } = {}): Promise<EquityDecision> {
  const { pc, wallet, agentAddr } = clients(cfg);
  const c = { address: cfg.pool, abi: equityPoolAbi } as const;

  const [asset, agent, paused, marketOpen, idle, totalDeployed, nav, maxMove, perVenueCap, maxTotal] =
    await Promise.all([
      pc.readContract({ ...c, functionName: "asset" }),
      pc.readContract({ ...c, functionName: "agent" }),
      pc.readContract({ ...c, functionName: "paused" }),
      pc.readContract({ ...c, functionName: "marketOpen" }),
      pc.readContract({ ...c, functionName: "idleBalance" }),
      pc.readContract({ ...c, functionName: "totalDeployed" }),
      pc.readContract({ ...c, functionName: "totalAssets" }),
      pc.readContract({ ...c, functionName: "maxMoveSize" }),
      pc.readContract({ ...c, functionName: "perVenueCap" }),
      pc.readContract({ ...c, functionName: "maxTotalDeployed" }),
    ]);

  const [dec, allowed, principal, liveBal] = await Promise.all([
    pc.readContract({ address: asset as Address, abi: erc20Abi, functionName: "decimals" }),
    pc.readContract({ ...c, functionName: "venueAllowed", args: [cfg.venue] }),
    pc.readContract({ ...c, functionName: "allocated", args: [cfg.venue] }),
    pc.readContract({ ...c, functionName: "venueBalance", args: [cfg.venue] }),
  ]);
  const decimals = Number(dec);
  const exposure = liveBal > principal ? liveBal : principal; // cap basis the contract uses

  const view: EquityPoolView = {
    allowed: Boolean(allowed),
    paused: Boolean(paused),
    marketOpen: Boolean(marketOpen),
    idle,
    exposure,
    totalDeployed,
    maxMove,
    perVenueCap,
    maxTotal,
  };
  const { deployable, reason } = computeDeployable(view);

  const decision: EquityDecision = {
    at: new Date().toISOString(),
    marketOpen: Boolean(marketOpen),
    paused: Boolean(paused),
    idle,
    exposure,
    totalDeployed,
    nav,
    deployable,
    reason,
    action: deployable > 0n ? "allocate" : "hold",
  };

  const willExecute = cfg.execute && !opts.dryRun && deployable > 0n;
  if (willExecute) {
    if (!wallet || !agentAddr) throw new Error("EXECUTE=1 but AGENT_PRIVATE_KEY is not set");
    if (agentAddr.toLowerCase() !== (agent as string).toLowerCase()) {
      throw new Error(`key ${agentAddr} is not the equity pool agent ${agent}; refusing to send`);
    }
    try {
      const hash = await wallet.writeContract({
        account: wallet.account!,
        chain: wallet.chain,
        address: cfg.pool,
        abi: equityPoolAbi,
        functionName: "allocate",
        args: [cfg.venue, deployable, stringToHex("equity-exposure", { size: 32 })],
      });
      decision.hash = hash;
      const rcpt = await pc.waitForTransactionReceipt({ hash });
      decision.status = rcpt.status === "success" ? "confirmed" : "reverted";
    } catch (err) {
      decision.status = "error";
      decision.error = err instanceof Error ? err.message : String(err);
    }
  }

  printEquity(cfg, decision, decimals, willExecute);
  try {
    mkdirSync(dirname(RECEIPTS), { recursive: true });
    appendFileSync(RECEIPTS, JSON.stringify({ ...decision, idle: decision.idle.toString(), exposure: decision.exposure.toString(), totalDeployed: decision.totalDeployed.toString(), nav: decision.nav.toString(), deployable: decision.deployable.toString() }) + "\n");
  } catch {
    // receipts are best-effort; never fail a cycle on a write error
  }
  return decision;
}

function printEquity(cfg: EquityConfig, d: EquityDecision, dec: number, executing: boolean) {
  console.log("\n──────────────────────────────────────────────");
  console.log(` Aumo equity · ${d.at}`);
  console.log("──────────────────────────────────────────────");
  console.log(` Pool ${cfg.pool}  (${cfg.venueName})`);
  console.log(
    ` market ${d.marketOpen ? "OPEN" : "CLOSED"}${d.paused ? " · PAUSED" : ""} · idle ${fmt(d.idle, dec)} · exposure ${fmt(
      d.exposure,
      dec,
    )} · NAV ${fmt(d.nav, dec)}`,
  );
  console.log(`\n Decision: ${d.action.toUpperCase()} — ${d.reason}`);
  if (d.hash) console.log(`  ${(d.status ?? "sent").toUpperCase()}  ${d.hash}${d.error ? "  " + d.error : ""}`);
  else if (executing) console.log("  (executing)");
  else if (d.action === "allocate") console.log("  Dry-run. No transaction sent.");
  console.log("──────────────────────────────────────────────\n");
}

/** Repeat an equity tick every LOOP_INTERVAL_SECONDS. */
export async function equityLoop(cfg: EquityConfig): Promise<void> {
  console.log(
    `Aumo equity executor · pool ${cfg.pool} · venue ${cfg.venueName} ${cfg.venue} · interval ${
      cfg.loopIntervalMs / 1000
    }s · execute=${cfg.execute}`,
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await equityTick(cfg);
    } catch (err) {
      console.error("equity tick error:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, cfg.loopIntervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] ?? "plan";
  const cfg = loadEquityConfig();
  (cmd === "loop" ? equityLoop(cfg) : equityTick(cfg, { dryRun: cmd === "plan" })).catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
