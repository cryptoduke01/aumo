import { readAaveMarketAt } from "../src/sense/aaveFeed.js";

// Aave v3 on X Layer mainnet — USDT0 reserve.
const POOL = "0xE3F3Caefdd7180F884c01E57f65Df979Af84f116";
const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const RPC = process.env.XLAYER_MAINNET_RPC ?? "https://rpc.xlayer.tech";

const m = await readAaveMarketAt(RPC, POOL, USDT0);
console.log("Aave X Layer · USDT0 reserve (live):");
console.log(`  supply APY   ${(m.apyBps / 100).toFixed(2)}%`);
console.log(`  TVL          $${m.tvlUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
console.log(`  liquidity    $${m.liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
console.log(`  utilization  ${(m.utilization * 100).toFixed(1)}%`);
console.log(`  aToken       ${m.aToken}`);
