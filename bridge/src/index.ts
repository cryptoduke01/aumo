import "dotenv/config";
import { parseUnits, formatUnits, type Address } from "viem";
import { quote, send } from "./bridge.js";

const DEFAULT_RECIPIENT = "0x197ED5B2313fA482EC271861360E839A8eF75731";

const HELP = `Aumo bridge — move USDT0 onto X Layer via LayerZero's native OFT.

Usage:
  npm run quote <amount>    Quote the bridge (read-only, no funds moved).
  npm run send  <amount>    Execute the bridge. Requires SEND=1 and PRIVATE_KEY.

Config (.env): SOURCE_CHAIN, RECIPIENT, SLIPPAGE_BPS, SOURCE_RPC.
`;

async function main() {
  const cmd = process.argv[2] ?? "quote";
  const amountArg = process.argv[3];
  const source = process.env.SOURCE_CHAIN ?? "arbitrum";
  const recipient = (process.env.RECIPIENT ?? DEFAULT_RECIPIENT) as Address;
  const slippageBps = Number(process.env.SLIPPAGE_BPS ?? "0");
  const rpc = process.env.SOURCE_RPC;

  if (cmd === "help" || cmd === "--help" || !amountArg) {
    console.log(HELP);
    process.exit(amountArg ? 0 : 1);
  }

  // USDT0 / USDT is 6 decimals on every supported source chain.
  const amount = parseUnits(amountArg, 6);

  if (cmd === "quote") {
    const q = await quote(source, recipient, amount, slippageBps, rpc);
    console.log("\n  Aumo bridge quote");
    console.log("  ─────────────────");
    console.log(`  route        ${q.source.name} (eid ${q.source.eid}) → X Layer (eid ${q.destination.eid})`);
    console.log(`  token        ${q.tokenSymbol} ${q.token}`);
    console.log(`  amount       ${formatUnits(q.amountLD, q.tokenDecimals)} ${q.tokenSymbol}`);
    console.log(`  min received ${formatUnits(q.minReceivedLD, q.tokenDecimals)} USDT0 on X Layer`);
    console.log(`  bridge fee   ${q.nativeFeeEth} (native gas token on ${q.source.name})`);
    console.log(`  recipient    ${q.destination.recipient}`);
    console.log(`  lands as     USDT0 ${q.destination.usdt0}\n`);
    return;
  }

  if (cmd === "send") {
    if (process.env.SEND !== "1") {
      console.error("Refusing to send: set SEND=1 to move real funds.");
      process.exit(1);
    }
    const pk = process.env.PRIVATE_KEY?.trim();
    if (!pk) {
      console.error("Refusing to send: PRIVATE_KEY is not set.");
      process.exit(1);
    }
    const key = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
    const r = await send(source, key, recipient, amount, slippageBps, rpc);
    console.log("\n  Bridge sent");
    if (r.approvalTxHash) console.log(`  approval  ${r.approvalTxHash}`);
    console.log(`  send tx   ${r.txHash}`);
    console.log(`  amount    ${formatUnits(r.amountLD, 6)} USDT0 → ${r.recipient} on X Layer`);
    console.log("  LayerZero will deliver to X Layer shortly.\n");
    return;
  }

  console.log(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
