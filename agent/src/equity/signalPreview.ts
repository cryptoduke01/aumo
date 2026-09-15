/**
 * Dry-run preview of the Option-A trend overlay against the LIVE mainnet pools. Reads each pool's
 * on-chain state (exposure, idle, market status) and the trend signal, and prints the action the
 * agent WOULD take — sends nothing, needs no key. Run: `npx tsx src/equity/signalPreview.ts`.
 */
import { createPublicClient, http, defineChain, parseAbi } from "viem";
import { trendSignal, DEFAULT_SIGNAL } from "./signal.js";

const xlayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
});

const abi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function totalDeployed() view returns (uint256)",
  "function idleBalance() view returns (uint256)",
  "function marketOpen() view returns (bool)",
]);

const STOCKS = [
  { symbol: "NVDAx", pool: "0x42ee28ADcA2323689f9c5c8f733B9F56fbb4F7aA" },
  { symbol: "AAPLx", pool: "0xD66a4473C4b81397A090248d05179b7da04993d0" },
  { symbol: "MSFTx", pool: "0xEE9Cfb0D6847BbC546E0c11538816Ea1f3DAf870" },
  { symbol: "METAx", pool: "0xC70881EE201FB6979f90CF39A690D6816BB30463" },
] as const;

const usd = (v: bigint) => `$${(Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const DUST = 1_000_000n; // $1 — below this the pool counts as flat (out)

async function main() {
  const pc = createPublicClient({ chain: xlayer, transport: http() });
  console.log(`\nAumo equity trend overlay — dry run  (SMA ${DEFAULT_SIGNAL.smaPeriod}d, band ±${DEFAULT_SIGNAL.bufferBps / 100}%, drawdown ${DEFAULT_SIGNAL.drawdownPct}%)\n`);
  for (const s of STOCKS) {
    const c = { address: s.pool as `0x${string}`, abi } as const;
    const [nav, deployed, idle, open] = await Promise.all([
      pc.readContract({ ...c, functionName: "totalAssets" }),
      pc.readContract({ ...c, functionName: "totalDeployed" }),
      pc.readContract({ ...c, functionName: "idleBalance" }),
      pc.readContract({ ...c, functionName: "marketOpen" }),
    ]);
    const currentlyIn = deployed > DUST;
    const sig = await trendSignal(s.symbol, currentlyIn, DEFAULT_SIGNAL);

    let action: string;
    if (!open) action = "HOLD — market closed (trend moves only while open)";
    else if (sig.target === "out" && currentlyIn) action = `DE-RISK — sell ${usd(deployed)} exposure to idle`;
    else if (sig.target === "in" && !currentlyIn && idle > DUST) action = `ENTER — buy up to ${usd(idle)} idle`;
    else action = `HOLD — already ${currentlyIn ? "in" : "out"}`;

    console.log(`${s.symbol.padEnd(7)} state=${currentlyIn ? "IN " : "OUT"}  nav=${usd(nav)}  deployed=${usd(deployed)}  idle=${usd(idle)}  market=${open ? "open" : "closed"}`);
    console.log(`         signal=${sig.target.toUpperCase().padEnd(3)}  ${sig.reason}`);
    console.log(`         -> ${action}\n`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
