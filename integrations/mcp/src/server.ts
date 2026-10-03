import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Address } from "viem";
import type { AgentApi } from "./agentApi.js";
import type { ChainReader, PoolState, Simulation } from "./chain.js";
import { addrUrl, ASSET_SYMBOL, CHAIN_ID, POOL, USDT0 } from "./config.js";
import {
  mapCsvDecision,
  mapDecision,
  mapReplay,
  mapStatus,
  mapVenues,
  matchesFilter,
  sameInstant,
  units,
  type DecisionFilter,
} from "./mapping.js";
import {
  askShape,
  decisionsShape,
  positionShape,
  prepareDepositShape,
  prepareWithdrawShape,
  replayShape,
} from "./schemas.js";
import { buildApproveTx, buildDepositTx, buildRedeemTx, buildWithdrawTx, fmtAsset, type UnsignedTx } from "./tx.js";
import type { DecisionRecord } from "./types.js";

export const SERVER_NAME = "aumo";
export const SERVER_VERSION = "0.1.0";

export interface Deps {
  api: AgentApi;
  chain: ChainReader;
  now?: () => Date;
}

const NO_KEYS =
  "This server never holds keys, never signs, and never broadcasts: the caller's own wallet must review, sign, and send each transaction.";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(result: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function fail(e: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
}

const guard =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const RECENT_WINDOW = 10; // receipts scanned before falling back to the CSV index
const HELD_PAGE = 25;
const HELD_MAX_SCAN = 500;

/**
 * Fetch one receipt whose position in the trail is known from the CSV index. New decisions may have
 * landed since the index was read, which pushes the target further back, so search a small window
 * first and a wider one before giving up.
 */
async function receiptAtOffset(api: AgentApi, takenAt: string, offset: number): Promise<DecisionRecord | null> {
  const near = await api.receipts(3, offset);
  const hit = near.find((r) => sameInstant(r.takenAt, takenAt));
  if (hit) return hit;
  const wide = await api.receipts(40, Math.max(0, offset - 20));
  return wide.find((r) => sameInstant(r.takenAt, takenAt)) ?? null;
}

async function findDecision(api: AgentApi, takenAt: string): Promise<DecisionRecord | null> {
  const recent = await api.receipts(RECENT_WINDOW, 0);
  const hit = recent.find((r) => sameInstant(r.takenAt, takenAt));
  if (hit) return hit;
  const rows = await api.decisionsCsv();
  const i = rows.findIndex((r) => sameInstant(r.takenAt, takenAt));
  if (i < 0) return null;
  return receiptAtOffset(api, takenAt, rows.length - 1 - i);
}

function simulationNote(sim: Simulation): string {
  if (sim.status === "ok") return "Dry run (eth_call) succeeded against the current chain state.";
  if (sim.status === "reverts") return `Dry run reverted: ${sim.reason}`;
  return `Dry run inconclusive (RPC problem, not a revert): ${sim.reason}`;
}

export function createAumoServer(deps: Deps): McpServer {
  const { api, chain } = deps;
  const now = deps.now ?? (() => new Date());

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Aumo is an autonomous treasury agent for stablecoins on X Layer (chainId 196). Idle USDT0 deposited into the Aumo pool earns yield across allowlisted venues inside on-chain guardrails, and can be withdrawn when needed. Use aumo_status and aumo_venues to orient, aumo_decisions and aumo_replay_decision to audit the agent's reasoning, aumo_position to check a wallet, and aumo_prepare_deposit / aumo_prepare_withdraw to get unsigned transactions. " +
        NO_KEYS,
    },
  );

  server.registerTool(
    "aumo_status",
    {
      title: "Aumo agent status",
      description:
        "Headline state of the Aumo treasury agent on X Layer: whether it is online, how many decisions it has recorded (rebalanced vs held), the current market regime, when it last decided, its latest summary, and the pool's total assets. A good first call to orient.",
      annotations: READ_ONLY,
    },
    guard(async () => {
      const [status, healthOk, pool] = await Promise.all([
        api.status(),
        api.health(),
        chain.poolState().catch((e: unknown): { error: string } => ({
          error: `Could not read the pool on-chain: ${e instanceof Error ? e.message : String(e)}`,
        })),
      ]);
      return mapStatus(status, healthOk, now(), pool as PoolState | { error: string });
    }),
  );

  server.registerTool(
    "aumo_venues",
    {
      title: "Aumo yield venues",
      description:
        "The yield venues the Aumo agent can put the pool's USDT0 into, from its latest decision: APY, risk-adjusted APY, risk score (0 to 100) and band, whether the venue is allowlisted on-chain, and how much of the pool currently sits in each.",
      annotations: READ_ONLY,
    },
    guard(async () => {
      const [latest] = await api.receipts(1, 0);
      if (!latest) throw new Error("The agent has not recorded any decisions yet.");
      return mapVenues(latest);
    }),
  );

  server.registerTool(
    "aumo_decisions",
    {
      title: "Recent Aumo decisions",
      description:
        'Recent Aumo agent decisions, newest first. Each has its timestamp (takenAt), market regime, plain-language summary, the moves it made (venue, direction, USDT0 amount), and on-chain transaction links. Use filter "moved" to see only decisions that rebalanced funds (they are rare; most cycles hold). Pass a takenAt to aumo_replay_decision for the full reasoning.',
      inputSchema: decisionsShape,
      annotations: READ_ONLY,
    },
    guard(async ({ limit, filter }: { limit: number; filter: DecisionFilter }) => {
      if (filter === "all") {
        const page = await api.receipts(limit, 0);
        return { filter, count: page.length, decisions: page.map(mapDecision) };
      }

      if (filter === "held") {
        const found: DecisionRecord[] = [];
        let offset = 0;
        while (found.length < limit && offset < HELD_MAX_SCAN) {
          const page = await api.receipts(HELD_PAGE, offset);
          if (page.length === 0) break;
          found.push(...page.filter((r) => matchesFilter(r, "held")));
          offset += page.length;
        }
        const decisions = found.slice(0, limit).map(mapDecision);
        return { filter, count: decisions.length, scanned: offset, decisions };
      }

      // "moved": rebalances are sparse (a few percent of cycles), so locate them through the CSV
      // index of the whole trail instead of paging through hundreds of holds.
      const rows = await api.decisionsCsv();
      const movedIdx: number[] = [];
      for (let i = rows.length - 1; i >= 0 && movedIdx.length < limit; i--) {
        if (rows[i]!.action === "rebalanced") movedIdx.push(i);
      }
      const totalMoved = rows.filter((r) => r.action === "rebalanced").length;
      const decisions = await mapLimit(movedIdx, 4, async (i) => {
        const row = rows[i]!;
        try {
          const rec = await receiptAtOffset(api, row.takenAt, rows.length - 1 - i);
          if (rec) return mapDecision(rec);
        } catch {
          /* fall through to the CSV row */
        }
        return mapCsvDecision(row);
      });
      return { filter, count: decisions.length, totalMovedAllTime: totalMoved, decisions };
    }),
  );

  server.registerTool(
    "aumo_replay_decision",
    {
      title: "Replay an Aumo decision",
      description:
        "The full reasoning chain behind one Aumo decision: per-venue risk scores and their components, the stress test, the agent's reflection on its past calls, the specialist panel's verdicts, the critic's review, the planned moves with rationale, and what was executed on-chain (with transaction links). Identify the decision by its takenAt from aumo_decisions, or omit takenAt for the latest.",
      inputSchema: replayShape,
      annotations: READ_ONLY,
    },
    guard(async ({ takenAt }: { takenAt?: string }) => {
      let rec: DecisionRecord | null | undefined;
      if (!takenAt) [rec] = await api.receipts(1, 0);
      else rec = await findDecision(api, takenAt);
      if (!rec) {
        throw new Error(
          takenAt
            ? `No decision found with takenAt ${takenAt}. Call aumo_decisions to list valid timestamps.`
            : "The agent has not recorded any decisions yet.",
        );
      }
      return mapReplay(rec);
    }),
  );

  server.registerTool(
    "aumo_ask",
    {
      title: "Ask the Aumo agent",
      description:
        "Ask the Aumo agent a question in plain language and get its own answer, grounded in its live state: strategy, where the yield comes from, venues, and its latest decision. Pass a wallet address to ask about that wallet's own position. The agent answers in 2 to 4 sentences, gives no financial advice, and limits callers to about 12 questions per minute.",
      inputSchema: askShape,
      annotations: { ...READ_ONLY, idempotentHint: false },
    },
    guard(async ({ question, address }: { question: string; address?: Address }) => {
      const answer = await api.ask(question, address);
      return address ? { question, address, answer } : { question, answer };
    }),
  );

  server.registerTool(
    "aumo_position",
    {
      title: "Wallet position in the Aumo pool",
      description:
        "A wallet's position in the Aumo pool on X Layer, read live on-chain: pool shares, percent of the pool, USDT0 redeemable right now (including accrued yield, net of any exit levy), plus the wallet's USDT0 balance and its current USDT0 allowance to the pool.",
      inputSchema: positionShape,
      annotations: READ_ONLY,
    },
    guard(async ({ address }: { address: Address }) => {
      const p = await chain.position(address);
      const sharePct =
        p.pool.totalSupply > 0n ? Math.round((Number(p.shares) / Number(p.pool.totalSupply)) * 1e6) / 1e4 : 0;
      return {
        address,
        chainId: CHAIN_ID,
        pool: POOL,
        isDepositor: p.shares > 0n,
        shares: units(p.shares, p.pool.shareDecimals),
        sharePct,
        redeemableUsdt0: fmtAsset(p.redeemable),
        walletUsdt0: fmtAsset(p.walletAsset),
        allowanceToPoolUsdt0: fmtAsset(p.allowance),
        depositsPaused: p.pool.paused,
        explorer: addrUrl(address),
      };
    }),
  );

  server.registerTool(
    "aumo_prepare_deposit",
    {
      title: "Prepare an Aumo deposit (unsigned)",
      description:
        "Prepare the UNSIGNED transactions to deposit USDT0 into the Aumo pool on X Layer (chainId 196), so idle stablecoins earn inside the pool's on-chain guardrails. Returns an exact-amount USDT0 approve step when the current allowance is too low, then the deposit call, each as {to, data, value, chainId} with a plain summary, plus balance checks and expected shares. " +
        NO_KEYS,
      inputSchema: prepareDepositShape,
      annotations: READ_ONLY,
    },
    guard(async ({ from, amount, receiver }: { from: Address; amount: bigint; receiver?: Address }) => {
      const to = receiver ?? from;
      const warnings: string[] = [];
      let needsApproval = true;
      let expectedShares: string | null = null;
      let state: Awaited<ReturnType<ChainReader["position"]>> | null = null;

      try {
        const [pos, shares] = await Promise.all([chain.position(from), chain.previewDeposit(amount)]);
        state = pos;
        needsApproval = pos.allowance < amount;
        expectedShares = units(shares, pos.pool.shareDecimals);
        if (pos.walletAsset < amount) {
          warnings.push(`Wallet holds ${fmtAsset(pos.walletAsset)} ${ASSET_SYMBOL}, less than the ${fmtAsset(amount)} requested. The deposit would revert.`);
        }
        if (pos.pool.paused) warnings.push("Deposits are paused on the pool right now, so the deposit would revert. Withdrawals are never paused.");
      } catch (e) {
        warnings.push(
          `Could not read chain state (${e instanceof Error ? e.message : String(e)}). The approve step is included as a precaution; the wallet should still simulate before sending.`,
        );
      }

      const transactions: UnsignedTx[] = [];
      if (needsApproval) transactions.push(buildApproveTx(from, amount, 1));
      const deposit = buildDepositTx(from, amount, to, transactions.length + 1);
      transactions.push(deposit);

      let dryRun: string;
      if (needsApproval) dryRun = "Skipped: the deposit can only be simulated after the approve step confirms.";
      else dryRun = simulationNote(await chain.simulate({ from, to: deposit.to, data: deposit.data }));

      return {
        chainId: CHAIN_ID,
        network: "X Layer",
        pool: POOL,
        asset: { symbol: ASSET_SYMBOL, address: USDT0 },
        amountUsdt0: fmtAsset(amount),
        receiver: to,
        expectedShares,
        currentAllowanceUsdt0: state ? fmtAsset(state.allowance) : null,
        walletUsdt0: state ? fmtAsset(state.walletAsset) : null,
        transactions,
        dryRun,
        warnings,
        howToSend: `Sign and send the transactions in step order from ${from} on chainId ${CHAIN_ID}, waiting for each to confirm before the next. ${NO_KEYS}`,
      };
    }),
  );

  server.registerTool(
    "aumo_prepare_withdraw",
    {
      title: "Prepare an Aumo withdrawal (unsigned)",
      description:
        'Prepare the UNSIGNED transaction to withdraw USDT0 from the Aumo pool on X Layer (chainId 196), for example when an agent needs its funds back to pay for something. Give a USDT0 amount, or "max" to exit the whole position. Returns {to, data, value, chainId} with a plain summary and a dry run showing whether it would succeed right now. Withdrawals are never paused. ' +
        NO_KEYS,
      inputSchema: prepareWithdrawShape,
      annotations: READ_ONLY,
    },
    guard(async ({ owner, amount, receiver }: { owner: Address; amount: bigint | "max"; receiver?: Address }) => {
      const to = receiver ?? owner;
      const warnings: string[] = [];
      let tx: UnsignedTx;
      let expected: Record<string, string | null> = {};
      let redeemable: bigint | null = null;

      if (amount === "max") {
        const pos = await chain.position(owner); // a full exit needs the live share balance
        if (pos.shares === 0n) throw new Error(`${owner} holds no Aumo pool shares, so there is nothing to withdraw.`);
        redeemable = pos.redeemable;
        const label = units(pos.shares, pos.pool.shareDecimals) ?? pos.shares.toString();
        tx = buildRedeemTx(owner, pos.shares, to, label, 1);
        const out = await chain.previewRedeem(pos.shares).catch(() => pos.redeemable);
        expected = { sharesBurned: label, expectedUsdt0: fmtAsset(out) };
      } else {
        tx = buildWithdrawTx(owner, amount, to, 1);
        try {
          const [pos, sharesBurned] = await Promise.all([chain.position(owner), chain.previewWithdraw(amount)]);
          redeemable = pos.redeemable;
          expected = { sharesBurned: units(sharesBurned, pos.pool.shareDecimals), expectedUsdt0: fmtAsset(amount) };
          if (amount > pos.redeemable) {
            warnings.push(`Requested ${fmtAsset(amount)} ${ASSET_SYMBOL} but only ${fmtAsset(pos.redeemable)} is redeemable for ${owner}. The withdrawal would revert; use a smaller amount or "max".`);
          }
        } catch (e) {
          warnings.push(`Could not read the position on-chain (${e instanceof Error ? e.message : String(e)}); the wallet should simulate before sending.`);
        }
      }

      const sim = await chain.simulate({ from: owner, to: tx.to, data: tx.data });
      // Explain a revert only when the balance does not already explain it.
      if (sim.status === "reverts" && amount !== "max" && redeemable !== null && amount <= redeemable) {
        warnings.push(
          'The pool would reject this withdrawal right now. Part of the pool may sit in a fixed-term venue that realizes slightly below its marked value before maturity. Try a smaller amount, or "max", which redeems all shares at realizable value.',
        );
      }

      return {
        chainId: CHAIN_ID,
        network: "X Layer",
        pool: POOL,
        asset: { symbol: ASSET_SYMBOL, address: USDT0 },
        owner,
        receiver: to,
        mode: amount === "max" ? "redeem all shares" : "withdraw exact amount",
        redeemableUsdt0: redeemable === null ? null : fmtAsset(redeemable),
        ...expected,
        transactions: [tx],
        dryRun: simulationNote(sim),
        warnings,
        howToSend: `Sign and send from ${owner} on chainId ${CHAIN_ID}. ${NO_KEYS}`,
      };
    }),
  );

  return server;
}
