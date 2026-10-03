#!/usr/bin/env node
// After the v3 redeploy is broadcast, point the app, docs and agent config at the new pools.
//
// Reads the Deployment that DeployV3Mainnet.run() returned (forge stores it in the broadcast file),
// pairs every v2 address with its v3 replacement, then rewrites the files that name v2 addresses
// and prints the agent's Railway variables with the same swap applied.
//
//   node script/apply-v3.mjs                       # show the v2 -> v3 map and what would change
//   node script/apply-v3.mjs --write               # rewrite web/lib/chain.ts, internals page, README
//   node script/apply-v3.mjs --env-file vars.txt   # also print KEY=VALUE lines with the swap applied
//   node script/apply-v3.mjs --dry-run             # use the simulation (broadcast/.../dry-run) instead
//
// Run from contracts/. It refuses a real broadcast file unless every transaction has a successful receipt.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const contracts = resolve(here, "..");
const repo = resolve(contracts, "..");

const { values: args } = parseArgs({
  options: {
    write: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    broadcast: { type: "string" },
    "env-file": { type: "string" },
    root: { type: "string" },
  },
});

const root = args.root ? resolve(args.root) : repo;
const FILES = ["web/lib/chain.ts", "web/app/(content)/internals/page.tsx", "README.md"];
const ZERO = "0x0000000000000000000000000000000000000000";
const ADDR = /0x[0-9a-fA-F]{40}/g;

// v2 addresses, in the order DeployV3Mainnet.planFromEnv() uses them, read from the script's own constants.
function v2Constants() {
  const src = readFileSync(resolve(here, "DeployV3Mainnet.s.sol"), "utf8");
  const c = {};
  for (const m of src.matchAll(/address internal constant (V2_[A-Z_]+) = (0x[0-9a-fA-F]{40});/g)) c[m[1]] = m[2];
  const need = (k) => {
    if (!c[k]) throw new Error(`constant ${k} not found in DeployV3Mainnet.s.sol`);
    return c[k];
  };
  const env = (k, fallback) => (process.env[k] ? process.env[k].split(",").map((s) => s.trim()) : fallback);
  const syms = ["NVDA", "AAPL", "MSFT", "META"];
  return {
    stockPools: env("V2_STOCK_POOLS", syms.map((s) => need(`V2_${s}_POOL`))),
    stockAdapters: env("V2_STOCK_ADAPTERS", syms.map((s) => need(`V2_${s}_ADAPTER`))),
    basketPool: process.env.V2_BASKET_POOL ?? need("V2_BASKET_POOL"),
    basketAdapters: env("V2_BASKET_ADAPTERS", syms.map((s) => need(`V2_BASKET_${s}`))),
    goldPool: process.env.V2_GOLD_POOL ?? need("V2_GOLD_POOL"),
    goldAdapter: process.env.V2_GOLD_ADAPTER ?? need("V2_GOLD_ADAPTER"),
    stable: ["V2_STABLE_POOL", "V2_STABLE_AAVE", "V2_STABLE_USDG", "V2_STABLE_PENDLE", "V2_STABLE_LP", "V2_STABLE_SPUSDT", "V2_ZAP"].map(
      (k) => process.env[k] ?? need(k),
    ),
  };
}

// The returned Deployment, as forge prints it:
// ([(v2, v3, [adapters]), ...stocks], (v2, v3, [adapters]) basket, (v2, v3, [adapter]) gold, (v2, v3, aave, usdg, pendle, lp, spUsdt, zap))
function parseDeployment(value) {
  const equity = [...value.matchAll(/\((0x[0-9a-fA-F]{40}), (0x[0-9a-fA-F]{40}), \[([^\]]*)\]\)/g)].map((m) => ({
    v2Pool: m[1],
    pool: m[2],
    adapters: m[3].match(ADDR) ?? [],
  }));
  const tail = value.slice(value.lastIndexOf("(")).match(ADDR) ?? [];
  if (equity.length < 2) throw new Error("could not read the equity deployments from the broadcast returns");
  return { stocks: equity.slice(0, -2), basket: equity.at(-2), gold: equity.at(-1), stable: tail.length === 8 ? tail : null };
}

function buildMap(d, v2) {
  const pairs = [];
  const add = (label, from, to) => {
    if (!from || !to || to === ZERO) return;
    pairs.push({ label, from, to });
  };
  const syms = ["NVDA", "AAPL", "MSFT", "META"];
  d.stocks.forEach((e, i) => {
    const sym = syms[i] ?? `stock${i}`;
    if (e.v2Pool.toLowerCase() !== v2.stockPools[i]?.toLowerCase()) throw new Error(`stock ${i}: returned v2 pool ${e.v2Pool} does not match the plan`);
    add(`${sym} pool`, e.v2Pool, e.pool);
    add(`${sym} adapter`, v2.stockAdapters[i], e.adapters[0]);
  });
  if (d.basket.pool !== ZERO) {
    if (d.basket.v2Pool.toLowerCase() !== v2.basketPool.toLowerCase()) throw new Error("basket: returned v2 pool does not match the plan");
    add("basket pool", d.basket.v2Pool, d.basket.pool);
    d.basket.adapters.forEach((a, i) => add(`basket ${syms[i]} adapter`, v2.basketAdapters[i], a));
  }
  if (d.gold.pool !== ZERO) {
    if (d.gold.v2Pool.toLowerCase() !== v2.goldPool.toLowerCase()) throw new Error("gold: returned v2 pool does not match the plan");
    add("gold pool", d.gold.v2Pool, d.gold.pool);
    add("gold adapter", v2.goldAdapter, d.gold.adapters[0]);
  }
  if (d.stable && d.stable[1] !== ZERO) {
    const names = ["stable pool", "stable aave", "stable usdg", "stable pendle", "stable lp", "stable spUSDT", "zap"];
    // returns order: v2Pool, pool, aave, usdg, pendle, lp, spUsdt, zap
    add(names[0], v2.stable[0], d.stable[1]);
    d.stable.slice(2).forEach((a, i) => add(names[i + 1], v2.stable[i + 1], a));
  }
  return pairs;
}

function swap(text, pairs) {
  let out = text;
  let hits = 0;
  for (const { from, to } of pairs) {
    const re = new RegExp(from, "gi");
    out = out.replace(re, () => {
      hits++;
      return to;
    });
  }
  return { out, hits };
}

const sub = args["dry-run"] ? "dry-run/run-latest.json" : "run-latest.json";
const bpath = args.broadcast ? resolve(args.broadcast) : resolve(contracts, "broadcast/DeployV3Mainnet.s.sol/196", sub);
if (!existsSync(bpath)) {
  console.error(`No broadcast file at ${bpath}. Run the deploy first, or pass --dry-run to use the simulation.`);
  process.exit(1);
}
const b = JSON.parse(readFileSync(bpath, "utf8"));
if (b.chain !== 196) throw new Error(`broadcast is for chain ${b.chain}, expected 196 (X Layer)`);
const isDry = bpath.includes("/dry-run/");
if (!isDry) {
  const bad = (b.receipts ?? []).filter((r) => r.status !== "0x1" && r.status !== 1);
  if (!b.receipts || b.receipts.length !== b.transactions.length || bad.length) {
    console.error(`Broadcast is incomplete: ${b.receipts?.length ?? 0}/${b.transactions.length} receipts, ${bad.length} failed. Finish or resume it first (forge script ... --resume).`);
    process.exit(1);
  }
}
const value = b.returns?.d?.value;
if (!value) throw new Error("broadcast has no returned Deployment (returns.d)");

const pairs = buildMap(parseDeployment(value), v2Constants());
console.log(`${isDry ? "SIMULATION" : "BROADCAST"} ${bpath}\n`);
console.log("v2 -> v3");
for (const p of pairs) console.log(`  ${p.label.padEnd(22)} ${p.from} -> ${p.to}`);
console.log("");

let total = 0;
for (const f of FILES) {
  const path = resolve(root, f);
  if (!existsSync(path)) continue;
  const { out, hits } = swap(readFileSync(path, "utf8"), pairs);
  total += hits;
  console.log(`  ${f}: ${hits} address${hits === 1 ? "" : "es"}${hits && args.write ? " rewritten" : ""}`);
  if (hits && args.write) writeFileSync(path, out);
}
if (!args.write) console.log("\nNothing written. Re-run with --write to apply.");

if (args["env-file"]) {
  console.log("\nRailway variables with the swap applied (changed lines only):");
  for (const line of readFileSync(resolve(args["env-file"]), "utf8").split("\n")) {
    if (!line.includes("=")) continue;
    const { out, hits } = swap(line, pairs);
    if (hits) console.log(`  ${out}`);
  }
}
if (isDry && args.write) console.log("\nNote: these are SIMULATED addresses. Re-run without --dry-run after the real broadcast.");
process.exitCode = total || !args.write ? 0 : 1;
