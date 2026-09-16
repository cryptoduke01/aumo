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
import { loadEquityConfig, type EquityConfig } from "./config.js";
import type { Address } from "../types.js";

/**
 * Diversified-basket executor (Option B). ONE EquityPool holds an equal-weight basket of stocks
 * through N adapters. The agent's ONLY job here is to keep the weights equal: each cycle it makes at
 * most one move toward NAV/N per venue, within the pool's caps. It does NOT time or pick — the
 * backtest (.internal/BASKET.md) shows diversification, not timing, is what cuts drawdown. Buy an
 * under-weight venue when idle is available; otherwise trim the most over-weight venue to free idle
 * for the next cycle. Successive cycles converge the basket; the drift band keeps it from churning.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECEIPTS = join(__dirname, "..", "..", "receipts", "basket.jsonl");
const DUST = 1_000_000n; // $1 in USD₮0 (6dp)
const fmt = (x: bigint) => (Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface BasketVenueView {
  symbol: string;
  venue: Address;
  balance: bigint; // this venue's value in USD₮0 terms
}
export interface BasketView {
  nav: bigint;
  idle: bigint;
  marketOpen: boolean;
  paused: boolean;
  totalDeployed: bigint;
  maxMove: bigint;
  perVenueCap: bigint;
  maxTotal: bigint;
  bandBps: number;
  venues: BasketVenueView[];
}
export interface RebalanceMove {
  action: "allocate" | "deallocate" | "hold";
  venue?: Address;
  symbol?: string;
  amount: bigint;
  targetEach: bigint;
  reason: string;
}

/** Pure, testable: pick the single best rebalance move toward equal weight, within band + caps. */
export function computeRebalance(v: BasketView): RebalanceMove {
  const none = (reason: string): RebalanceMove => ({ action: "hold", amount: 0n, targetEach: 0n, reason });
  if (v.paused) return none("pool paused");
  if (!v.marketOpen) return none("market closed — holding; entry/exit frozen by the pool");
  const n = v.venues.length;
  if (n === 0) return none("no venues configured");
  const targetEach = v.nav / BigInt(n);
  if (targetEach <= DUST) return none("basket too small to weight");
  const band = (targetEach * BigInt(v.bandBps)) / 10_000n;
  const lower = targetEach > band ? targetEach - band : 0n;
  const upper = targetEach + band;

  let under: { ve: BasketVenueView; d: bigint } | null = null;
  let over: { ve: BasketVenueView; d: bigint } | null = null;
  for (const ve of v.venues) {
    if (ve.balance < lower) {
      const d = targetEach - ve.balance;
      if (!under || d > under.d) under = { ve, d };
    }
    if (ve.balance > upper) {
      const d = ve.balance - targetEach;
      if (!over || d > over.d) over = { ve, d };
    }
  }

  // Prefer buying the most under-weight venue while idle is available.
  if (under && v.idle > DUST) {
    let amt = under.d;
    if (amt > v.idle) amt = v.idle;
    if (amt > v.maxMove) amt = v.maxMove;
    const venueHead = v.perVenueCap > under.ve.balance ? v.perVenueCap - under.ve.balance : 0n;
    if (amt > venueHead) amt = venueHead;
    const totalHead = v.maxTotal > v.totalDeployed ? v.maxTotal - v.totalDeployed : 0n;
    if (amt > totalHead) amt = totalHead;
    if (amt > DUST) {
      return {
        action: "allocate",
        venue: under.ve.venue,
        symbol: under.ve.symbol,
        amount: amt,
        targetEach,
        reason: `buy ${under.ve.symbol} toward equal weight (${fmt(under.ve.balance)} -> target ${fmt(targetEach)})`,
      };
    }
  }
  // Otherwise trim the most over-weight venue back to target (frees idle for the next cycle's buy).
  if (over) {
    let amt = over.d;
    if (amt > v.maxMove) amt = v.maxMove;
    if (amt > DUST) {
      return {
        action: "deallocate",
        venue: over.ve.venue,
        symbol: over.ve.symbol,
        amount: amt,
        targetEach,
        reason: `trim ${over.ve.symbol} to equal weight (${fmt(over.ve.balance)} -> target ${fmt(targetEach)})`,
      };
    }
  }
  return none(`basket within ${v.bandBps / 100}% of equal weight (target ${fmt(targetEach)} each)`);
}

function chainOf(cfg: EquityConfig) {
  return defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}
function clients(cfg: EquityConfig): { pc: PublicClient; wallet?: WalletClient; agentAddr?: Address } {
  const chain = chainOf(cfg);
  const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  if (!cfg.agentPrivateKey) return { pc };
  const account = privateKeyToAccount(cfg.agentPrivateKey);
  const wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  return { pc, wallet, agentAddr: account.address };
}

export async function basketTickOnce(cfg: EquityConfig, opts: { dryRun?: boolean } = {}) {
  if (!cfg.basket) {
    console.log("basket: EQUITY_BASKET_POOL/VENUES not configured — skipping");
    return;
  }
  const b = cfg.basket;
  const { pc, wallet, agentAddr } = clients(cfg);
  const c = { address: b.pool, abi: equityPoolAbi } as const;

  const [agent, paused, marketOpen, idle, totalDeployed, nav, maxMove, perVenueCap, maxTotal] =
    await Promise.all([
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
  const venues: BasketVenueView[] = await Promise.all(
    b.venues.map(async (vv) => ({
      symbol: vv.symbol,
      venue: vv.venue,
      balance: (await pc.readContract({ ...c, functionName: "venueBalance", args: [vv.venue] })) as bigint,
    })),
  );

  const view: BasketView = {
    nav: nav as bigint,
    idle: idle as bigint,
    marketOpen: Boolean(marketOpen),
    paused: Boolean(paused),
    totalDeployed: totalDeployed as bigint,
    maxMove: maxMove as bigint,
    perVenueCap: perVenueCap as bigint,
    maxTotal: maxTotal as bigint,
    bandBps: b.bandBps,
    venues,
  };
  const move = computeRebalance(view);

  const willExecute = cfg.execute && !opts.dryRun && move.action !== "hold" && move.amount > 0n;
  let hash: `0x${string}` | undefined;
  let status: "confirmed" | "reverted" | "error" | undefined;
  let error: string | undefined;
  if (willExecute) {
    if (!wallet || !agentAddr) throw new Error("EXECUTE=1 but AGENT_PRIVATE_KEY is not set");
    if (agentAddr.toLowerCase() !== (agent as string).toLowerCase()) {
      throw new Error(`key ${agentAddr} is not the basket pool agent ${agent}; refusing to send`);
    }
    try {
      hash =
        move.action === "allocate"
          ? await wallet.writeContract({
              account: wallet.account!,
              chain: wallet.chain,
              address: b.pool,
              abi: equityPoolAbi,
              functionName: "allocate",
              args: [move.venue!, move.amount, stringToHex("basket-rebalance", { size: 32 })],
            })
          : await wallet.writeContract({
              account: wallet.account!,
              chain: wallet.chain,
              address: b.pool,
              abi: equityPoolAbi,
              functionName: "deallocate",
              args: [move.venue!, move.amount],
            });
      const rcpt = await pc.waitForTransactionReceipt({ hash });
      status = rcpt.status === "success" ? "confirmed" : "reverted";
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }
  }

  printBasket(view, move, willExecute, hash, status, error);
  try {
    mkdirSync(dirname(RECEIPTS), { recursive: true });
    appendFileSync(
      RECEIPTS,
      JSON.stringify({
        at: new Date().toISOString(),
        pool: b.pool,
        marketOpen: view.marketOpen,
        paused: view.paused,
        nav: view.nav.toString(),
        idle: view.idle.toString(),
        totalDeployed: view.totalDeployed.toString(),
        targetEach: move.targetEach.toString(),
        action: move.action,
        symbol: move.symbol,
        venue: move.venue,
        amount: move.amount.toString(),
        reason: move.reason,
        weights: venues.map((v) => ({ symbol: v.symbol, balance: v.balance.toString() })),
        hash,
        status,
        error,
      }) + "\n",
    );
  } catch {
    // best-effort
  }
  return { move, view, hash, status, error };
}

function printBasket(
  v: BasketView,
  move: RebalanceMove,
  executing: boolean,
  hash?: string,
  status?: string,
  error?: string,
) {
  console.log("\n══════════════════════════════════════════════");
  console.log(` Aumo basket · ${new Date().toISOString()}`);
  console.log("══════════════════════════════════════════════");
  console.log(
    ` market ${v.marketOpen ? "OPEN" : "CLOSED"}${v.paused ? " · PAUSED" : ""} · NAV ${fmt(v.nav)} · idle ${fmt(
      v.idle,
    )} · target/venue ${fmt(v.nav / BigInt(Math.max(1, v.venues.length)))}`,
  );
  for (const ve of v.venues) console.log(`   ${ve.symbol.padEnd(6)} ${fmt(ve.balance)}`);
  console.log(`\n Move: ${move.action.toUpperCase()}${move.symbol ? " " + move.symbol : ""}${move.amount > 0n ? " " + fmt(move.amount) : ""} — ${move.reason}`);
  if (hash) console.log(`  ${(status ?? "sent").toUpperCase()}  ${hash}${error ? "  " + error : ""}`);
  else if (executing) console.log("  (executing)");
  else if (move.action !== "hold") console.log("  Dry-run. No transaction sent.");
  console.log("══════════════════════════════════════════════\n");
}

export async function basketLoop(cfg: EquityConfig): Promise<void> {
  console.log(
    `Aumo basket executor · pool ${cfg.basket?.pool} · ${cfg.basket?.venues.length ?? 0} venue(s): ${
      cfg.basket?.venues.map((v) => v.symbol).join(",") ?? ""
    } · band ${(cfg.basket?.bandBps ?? 0) / 100}% · interval ${cfg.loopIntervalMs / 1000}s · execute=${cfg.execute}`,
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await basketTickOnce(cfg).catch((err) =>
      console.error("basket tick error:", err instanceof Error ? err.message : err),
    );
    await new Promise((r) => setTimeout(r, cfg.loopIntervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] ?? "plan";
  const cfg = loadEquityConfig();
  (cmd === "loop" ? basketLoop(cfg) : basketTickOnce(cfg, { dryRun: cmd === "plan" })).catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
