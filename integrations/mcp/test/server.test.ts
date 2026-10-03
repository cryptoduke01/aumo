import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decodeFunctionData, type Address } from "viem";
import { csvToDecisions, type AgentApi } from "../src/agentApi.js";
import type { ChainReader, Position, Simulation } from "../src/chain.js";
import { POOL, USDT0 } from "../src/config.js";
import { createAumoServer } from "../src/server.js";
import { erc20Abi, poolAbi } from "../src/tx.js";
import { fixtureText, latestReceipts, movedReceipts, statusFixture } from "./helpers.js";

// End-to-end through a real MCP client over an in-memory transport, with the agent API served from
// the captured fixtures and the chain stubbed. Nothing touches the network.

const WALLET = "0x3333333333333333333333333333333333333333" as Address;

function fakeApi(): AgentApi & { asked: Array<{ q: string; a?: string }> } {
  const asked: Array<{ q: string; a?: string }> = [];
  return {
    asked,
    health: async () => true,
    status: async () => statusFixture(),
    // offset 0 is the head of the trail; any deeper page serves the page that holds the move.
    receipts: async (limit, offset = 0) => (offset === 0 ? latestReceipts() : movedReceipts()).slice(0, Math.max(limit, 3)),
    decisionsCsv: async () => csvToDecisions(fixtureText("decisions-excerpt.csv")),
    ask: async (q, a) => {
      asked.push({ q, a });
      return "I hold USDT0 in allowlisted venues.";
    },
  };
}

function fakeChain(pos: Partial<Position> = {}, sim: Simulation = { status: "ok" }): ChainReader & { simulated: number } {
  const pool = { paused: false, totalAssets: 46_127n, totalSupply: 432n, shareDecimals: 6 };
  const position: Position = { shares: 0n, redeemable: 0n, walletAsset: 0n, allowance: 0n, pool, ...pos };
  const reader = {
    simulated: 0,
    poolState: async () => pool,
    position: async () => position,
    previewDeposit: async (a: bigint) => a / 100n,
    previewWithdraw: async (a: bigint) => a / 100n,
    previewRedeem: async (s: bigint) => s * 100n,
    simulate: async (): Promise<Simulation> => {
      reader.simulated++;
      return sim;
    },
  };
  return reader;
}

async function connect(api: AgentApi, chain: ChainReader) {
  const server = createAumoServer({ api, chain, now: () => new Date("2026-10-03T01:40:00.000Z") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
  return { isError: res.isError === true, text, json: res.isError ? null : JSON.parse(text) };
}

test("lists all eight tools; the prepare tools state they never sign", async () => {
  const client = await connect(fakeApi(), fakeChain());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "aumo_ask",
    "aumo_decisions",
    "aumo_position",
    "aumo_prepare_deposit",
    "aumo_prepare_withdraw",
    "aumo_replay_decision",
    "aumo_status",
    "aumo_venues",
  ]);
  for (const t of tools.filter((t) => t.name.startsWith("aumo_prepare"))) {
    assert.match(t.description!, /never holds keys, never signs, and never broadcasts/);
    assert.match(t.description!, /UNSIGNED/);
  }
  const dep = tools.find((t) => t.name === "aumo_prepare_deposit")!;
  assert.deepEqual([...(dep.inputSchema.required ?? [])].sort(), ["amount", "from"]);
});

test("aumo_status and aumo_venues return mapped fixture data", async () => {
  const client = await connect(fakeApi(), fakeChain());
  const status = await call(client, "aumo_status");
  assert.equal(status.isError, false);
  assert.equal(status.json.decisions.total, 5109);
  assert.equal(status.json.minutesSinceLastDecision, 4);
  assert.equal(status.json.pool.totalAssetsUsdt0, "0.046127");

  const venues = await call(client, "aumo_venues");
  assert.equal(venues.isError, false);
  assert.equal(venues.json.venues.length, 5);
  assert.ok(venues.json.venues.every((v: { allowlisted: unknown }) => typeof v.allowlisted === "boolean"));
});

test("aumo_decisions: moved filter finds the real rebalance via the CSV index", async () => {
  const client = await connect(fakeApi(), fakeChain());
  const res = await call(client, "aumo_decisions", { filter: "moved", limit: 3 });
  assert.equal(res.isError, false);
  assert.equal(res.json.count, 3);
  assert.equal(res.json.totalMovedAllTime, 3);
  const pendle = res.json.decisions[0];
  assert.equal(pendle.takenAt, "2026-09-25T19:23:00.453Z");
  assert.equal(pendle.moves[0].amountUsdt0, "1.001481"); // enriched from the full receipt, not the CSV
  // The two August rebalances are not in the stubbed receipts, so they fall back to the CSV row.
  assert.equal(res.json.decisions[1].moves[0].venue, "MockYield");
  assert.equal(res.json.decisions[1].moves[0].amountUsdt0, null);

  const held = await call(client, "aumo_decisions", { filter: "held", limit: 2 });
  assert.equal(held.json.decisions.length, 2);
  assert.ok(held.json.decisions.every((d: { action: string }) => d.action === "held"));
});

test("aumo_replay_decision: latest by default, older ones by takenAt", async () => {
  const client = await connect(fakeApi(), fakeChain());
  const latest = await call(client, "aumo_replay_decision");
  assert.equal(latest.json.takenAt, latestReceipts()[0]!.takenAt);

  const old = await call(client, "aumo_replay_decision", { takenAt: "2026-09-25T19:23:00.453Z" });
  assert.equal(old.isError, false);
  assert.equal(old.json.outcome.executions[0].status, "confirmed");

  const missing = await call(client, "aumo_replay_decision", { takenAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /aumo_decisions/);
});

test("aumo_ask forwards the question and the checksummed address", async () => {
  const api = fakeApi();
  const client = await connect(api, fakeChain());
  const res = await call(client, "aumo_ask", { question: "what do you hold?", address: WALLET.toLowerCase() });
  assert.equal(res.json.answer, "I hold USDT0 in allowlisted venues.");
  assert.deepEqual(api.asked, [{ q: "what do you hold?", a: WALLET }]);
});

test("aumo_position formats shares, share of pool, and redeemable USDT0", async () => {
  const client = await connect(fakeApi(), fakeChain({ shares: 216n, redeemable: 23_063n, walletAsset: 5_000_000n, allowance: 0n }));
  const res = await call(client, "aumo_position", { address: WALLET });
  assert.equal(res.json.isDepositor, true);
  assert.equal(res.json.shares, "0.000216");
  assert.equal(res.json.sharePct, 50);
  assert.equal(res.json.redeemableUsdt0, "0.023063");
  assert.equal(res.json.walletUsdt0, "5");
});

test("aumo_prepare_deposit: approve first when allowance is short", async () => {
  const chain = fakeChain({ walletAsset: 100_000_000n, allowance: 1_000_000n });
  const client = await connect(fakeApi(), chain);
  const res = await call(client, "aumo_prepare_deposit", { from: WALLET, amount: "25.5" });
  assert.equal(res.isError, false);
  const [approve, deposit] = res.json.transactions;
  assert.equal(res.json.transactions.length, 2);
  assert.equal(approve.to, USDT0);
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: approve.data }).args, [POOL, 25_500_000n]);
  assert.equal(deposit.to, POOL);
  assert.equal(deposit.step, 2);
  assert.deepEqual(decodeFunctionData({ abi: poolAbi, data: deposit.data }).args, [25_500_000n, WALLET]);
  for (const tx of res.json.transactions) {
    assert.equal(tx.chainId, 196);
    assert.equal(tx.value, "0");
  }
  assert.equal(chain.simulated, 0); // cannot dry-run a deposit before its approval lands
  assert.deepEqual(res.json.warnings, []);
});

test("aumo_prepare_deposit: no approve when allowance covers it; warns on low balance", async () => {
  const chain = fakeChain({ walletAsset: 1_000_000n, allowance: 50_000_000n });
  const client = await connect(fakeApi(), chain);
  const res = await call(client, "aumo_prepare_deposit", { from: WALLET, amount: "10", receiver: POOL.toLowerCase() });
  assert.equal(res.json.transactions.length, 1);
  assert.equal(res.json.transactions[0].kind, "deposit");
  assert.deepEqual(decodeFunctionData({ abi: poolAbi, data: res.json.transactions[0].data }).args, [10_000_000n, POOL]);
  assert.equal(chain.simulated, 1);
  assert.match(res.json.warnings[0], /less than the 10 requested/);
});

test("aumo_prepare_withdraw: exact amount uses withdraw, max uses redeem of all shares", async () => {
  const client = await connect(fakeApi(), fakeChain({ shares: 432n, redeemable: 46_127n }));
  const exact = await call(client, "aumo_prepare_withdraw", { owner: WALLET, amount: "0.01" });
  const w = decodeFunctionData({ abi: poolAbi, data: exact.json.transactions[0].data });
  assert.equal(w.functionName, "withdraw");
  assert.deepEqual(w.args, [10_000n, WALLET, WALLET]);
  assert.equal(exact.json.dryRun, "Dry run (eth_call) succeeded against the current chain state.");

  const max = await call(client, "aumo_prepare_withdraw", { owner: WALLET, amount: "max" });
  const r = decodeFunctionData({ abi: poolAbi, data: max.json.transactions[0].data });
  assert.equal(r.functionName, "redeem");
  assert.deepEqual(r.args, [432n, WALLET, WALLET]);
  assert.equal(max.json.mode, "redeem all shares");

  const over = await call(client, "aumo_prepare_withdraw", { owner: WALLET, amount: "5" });
  assert.match(over.json.warnings[0], /only 0.046127 is redeemable/);
});

test("aumo_prepare_withdraw: a revert within the balance is explained; one over the balance is not misattributed", async () => {
  const reverting: Simulation = { status: "reverts", reason: "Execution reverted" };
  const client = await connect(fakeApi(), fakeChain({ shares: 432n, redeemable: 46_127n }, reverting));

  const within = await call(client, "aumo_prepare_withdraw", { owner: WALLET, amount: "0.04" });
  assert.equal(within.json.dryRun, "Dry run reverted: Execution reverted");
  assert.equal(within.json.warnings.length, 1);
  assert.match(within.json.warnings[0], /fixed-term venue/);

  const over = await call(client, "aumo_prepare_withdraw", { owner: WALLET, amount: "5" });
  assert.equal(over.json.warnings.length, 1);
  assert.match(over.json.warnings[0], /only 0.046127 is redeemable/);
});

test("aumo_prepare_withdraw: max with no shares is an error, not a zero-value tx", async () => {
  const client = await connect(fakeApi(), fakeChain());
  const res = await call(client, "aumo_prepare_withdraw", { owner: WALLET, amount: "max" });
  assert.equal(res.isError, true);
  assert.match(res.text, /holds no Aumo pool shares/);
});

test("invalid input is rejected before any work is done", async () => {
  const chain = fakeChain();
  const client = await connect(fakeApi(), chain);
  const cases: Array<[string, Record<string, unknown>]> = [
    ["aumo_prepare_deposit", { from: "0x123", amount: "1" }],
    ["aumo_prepare_deposit", { from: WALLET, amount: "1.1234567" }],
    ["aumo_prepare_withdraw", { owner: WALLET, amount: "-1" }],
    ["aumo_position", {}],
    ["aumo_decisions", { limit: 500 }],
    ["aumo_ask", { question: "" }],
  ];
  for (const [name, args] of cases) {
    let rejected = false;
    try {
      const res = await client.callTool({ name, arguments: args });
      rejected = res.isError === true;
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, `${name} ${JSON.stringify(args)} should be rejected`);
  }
  assert.equal(chain.simulated, 0);
});
