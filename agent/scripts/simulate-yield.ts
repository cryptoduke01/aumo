/**
 * Simulated testnet yield — HONEST demo helper, never runs on mainnet.
 *
 * X Layer testnet has no real DeFi, so the mock venues hold principal 1:1 and never grow on their
 * own. This script fast-forwards yield: for each venue it computes `liveBalance × APY × days/365` at
 * the venue's own stated APY, transfers exactly that many USDT0 into the adapter, and calls the
 * mock's accrue() so the pool's share value (and every depositor's redeemable balance) ticks up by a
 * realistic amount. It is funded from the agent's own testnet USDT0 and is clearly a simulation —
 * on mainnet the Aave and USDG adapters accrue for real and this script refuses to run.
 *
 * Run:  npm run simulate-yield -- 30     (simulate 30 days of yield; default 30)
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";
import { makeChain } from "../src/chain/client.js";
import { sense } from "../src/sense/sense.js";

const MAINNET = 196;
const adapterAbi = parseAbi([
  "function accrue(address account, uint256 yield)",
  "function balanceOf(address account) view returns (uint256)",
]);
const erc20 = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

async function main() {
  const days = Number(process.argv[2] ?? "30");
  if (!Number.isFinite(days) || days <= 0) throw new Error("usage: npm run simulate-yield -- <days>");

  const cfg = loadConfig();
  if (cfg.chainId === MAINNET) {
    throw new Error("refusing to simulate yield on mainnet (chainId 196) — real venues accrue for real");
  }
  if (!cfg.agentPrivateKey) throw new Error("AGENT_PRIVATE_KEY required to fund simulated yield");

  const chain = makeChain(cfg);
  const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const account = privateKeyToAccount(cfg.agentPrivateKey);
  const wc = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });

  const snap = await sense(pc, cfg);
  const dec = snap.vault.decimals;
  const unit = 10 ** dec;
  const asset = snap.vault.asset as Address;
  const pool = cfg.vaultAddress as Address;

  console.log(`\nSimulating ${days} days of yield on ${cfg.chainName} (chainId ${cfg.chainId})`);
  console.log(`funder ${account.address}\n`);

  let funded = 0;
  for (const v of snap.venues) {
    const live = v.liveBalance; // current value the pool holds in this venue
    if (live <= 0n || v.apyBps <= 0) continue;
    // yield = principal × APY × (days / 365), all in base units. Honest per-venue rate.
    const yieldUnits = (live * BigInt(v.apyBps) * BigInt(Math.round(days))) / (10_000n * 365n);
    if (yieldUnits <= 0n) {
      console.log(`  ${v.name.padEnd(22)} 0 (position too small for ${days}d to round up)`);
      continue;
    }
    // Fund the adapter with the yield tokens, then book them to the pool's position.
    const t1 = await wc.writeContract({ address: asset, abi: erc20, functionName: "transfer", args: [v.address as Address, yieldUnits] });
    await pc.waitForTransactionReceipt({ hash: t1 });
    const t2 = await wc.writeContract({ address: v.address as Address, abi: adapterAbi, functionName: "accrue", args: [pool, yieldUnits] });
    await pc.waitForTransactionReceipt({ hash: t2 });
    funded += Number(yieldUnits) / unit;
    console.log(`  ${v.name.padEnd(22)} +${(Number(yieldUnits) / unit).toFixed(4)} USDT0  @ ${(v.apyBps / 100).toFixed(2)}% APY  (${t2.slice(0, 12)}…)`);
  }

  // Show the new aggregate.
  const after = await sense(pc, cfg);
  const total = Number(after.vault.idle) / unit + after.venues.reduce((a, v) => a + Number(v.liveBalance) / unit, 0);
  console.log(`\n  simulated yield added: ${funded.toFixed(4)} USDT0`);
  console.log(`  pool total now:        ${total.toFixed(4)} USDT0\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
