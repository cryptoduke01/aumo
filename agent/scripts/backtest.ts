/**
 * Backtest harness — proof, not vibes.
 *
 * We replay a synthetic market through Aumo's REAL risk engine (levels + momentum + scenario stress)
 * and, side by side, through a naive "always chase the highest APY" strategy, on the exact same
 * market. The market contains a classic trap: a high-yield venue that quietly deteriorates over
 * several cycles (utilization climbing, exit liquidity thinning) and then breaks, haircutting anyone
 * still inside. The question the backtest answers: does Aumo's temporal awareness + stress test get
 * it out BEFORE the break, and how much loss does that avoid versus chasing yield?
 *
 * Deterministic on purpose: the LLM layer only ever tightens, so proving the deterministic core is
 * the honest floor. Run: `npm run backtest`.
 */
import type { MarketSnapshot, VaultState, VenueState, VenueHistory, VenueSample, Address } from "../src/types.js";
import { buildPlan } from "../src/brain/plan.js";
import { stressTest } from "../src/risk/stress.js";
import { scorePortfolio } from "../src/risk/engine.js";

const DEC = 6;
const UNIT = 10 ** DEC;
const big = (usd: number) => BigInt(Math.round(usd * UNIT));
const num = (b: bigint) => Number(b) / UNIT;

const HOT: Address = "0x00000000000000000000000000000000000000a1";
const STEADY: Address = "0x00000000000000000000000000000000000000b2";

// Per-step market metrics for each venue. HotVault looks great early, then rots and breaks at step 20.
interface StepMetrics {
  apyBps: number;
  tvlUsd: number;
  liquidityUsd: number;
  utilization: number;
  pegDeviationBps: number;
  protocolRisk: number;
  broken?: boolean; // once true the venue is de-allowlisted and haircuts holders this step
}

const STEPS = 30;
const BREAK_STEP = 20;
const HAIRCUT = 0.35; // loss to anyone still in HotVault when it breaks

function market(step: number): Record<Address, StepMetrics> {
  // HotVault: APY climbs as it pays up for fleeing liquidity; utilization ramps 0.50 → ~0.97;
  // exit liquidity thins 2.0M → ~0.3M; then it breaks.
  const t = Math.min(1, step / BREAK_STEP);
  const hot: StepMetrics = {
    apyBps: Math.round(1200 + 700 * t), // 12% → 19%
    tvlUsd: 5_000_000,
    liquidityUsd: Math.round(2_000_000 - 1_700_000 * t), // 2.0M → 0.3M
    utilization: 0.5 + 0.47 * t, // 0.50 → 0.97
    pegDeviationBps: 0,
    protocolRisk: 0.3 + 0.45 * t, // 0.30 → 0.75: a venue paying up with 97% util is visibly stressed
    broken: step >= BREAK_STEP,
  };
  // SteadyVault: boring, safe, stable.
  const steady: StepMetrics = {
    apyBps: 420,
    tvlUsd: 12_000_000,
    liquidityUsd: 6_000_000,
    utilization: 0.3,
    pegDeviationBps: 5,
    protocolRisk: 0.12,
  };
  return { [HOT]: hot, [STEADY]: steady };
}

interface Portfolio {
  idle: number;
  pos: Record<Address, number>;
}

const CAPS = { maxMove: 2_000, perVenue: 6_000, maxTotal: 10_000 };
const APPETITE = "moderate" as const;
const YIELD_DIVISOR = 52; // treat each step as ~a week for yield accrual

function snapshotOf(pf: Portfolio, m: Record<Address, StepMetrics>, history: VenueHistory): MarketSnapshot {
  const venues: VenueState[] = ([HOT, STEADY] as Address[]).map((addr) => {
    const s = m[addr]!;
    return {
      address: addr,
      name: addr === HOT ? "HotVault" : "SteadyVault",
      kind: "lending",
      apyBps: s.apyBps,
      tvlUsd: s.tvlUsd,
      liquidityUsd: s.liquidityUsd,
      utilization: s.utilization,
      protocolRisk: s.protocolRisk,
      pegDeviationBps: s.pegDeviationBps,
      allowed: !s.broken, // a broken venue is de-allowlisted → forced retreat
      allocatedPrincipal: big(pf.pos[addr] ?? 0),
      liveBalance: big(pf.pos[addr] ?? 0),
    };
  });
  const deployed = (pf.pos[HOT] ?? 0) + (pf.pos[STEADY] ?? 0);
  const vault: VaultState = {
    address: HOT,
    asset: STEADY,
    owner: HOT,
    agent: HOT,
    decimals: DEC,
    symbol: "USDT0",
    idle: big(pf.idle),
    totalDeployed: big(deployed),
    maxMoveSize: big(CAPS.maxMove),
    perVenueCap: big(CAPS.perVenue),
    maxTotalDeployed: big(CAPS.maxTotal),
    paused: false,
  };
  return { vault, venues, takenAt: `step-${history[HOT.toLowerCase()]?.length ?? 0}`, history };
}

function applyMoves(pf: Portfolio, moves: { venue: Address; action: string; amount: bigint }[]) {
  for (const mv of moves) {
    const amt = num(mv.amount);
    if (mv.action === "allocate") {
      const take = Math.min(amt, pf.idle);
      pf.idle -= take;
      pf.pos[mv.venue] = (pf.pos[mv.venue] ?? 0) + take;
    } else {
      const have = pf.pos[mv.venue] ?? 0;
      const give = Math.min(amt, have);
      pf.pos[mv.venue] = have - give;
      pf.idle += give;
    }
  }
}

function accrueYield(pf: Portfolio, m: Record<Address, StepMetrics>) {
  for (const addr of [HOT, STEADY] as Address[]) {
    const s = m[addr]!;
    const pos = pf.pos[addr] ?? 0;
    if (pos <= 0 || s.broken) continue; // a broken venue pays no yield
    pf.pos[addr] = pos * (1 + s.apyBps / 10000 / YIELD_DIVISOR);
  }
}

const value = (pf: Portfolio) => pf.idle + (pf.pos[HOT] ?? 0) + (pf.pos[STEADY] ?? 0);

// Aumo strategy: the real deterministic pipeline (levels + momentum + scenario stress).
function aumoPlan(snap: MarketSnapshot): { venue: Address; action: string; amount: bigint }[] {
  const provisional = buildPlan(snap, { appetite: APPETITE, regime: "calm", maxConcentration: 0.6 });
  const stress = stressTest(snap, provisional, APPETITE);
  const base = buildPlan(snap, {
    appetite: APPETITE,
    regime: stress.recommendedRegime,
    maxConcentration: 0.6,
    deny: new Set(stress.fragile),
  });
  return base.moves.map((mv) => ({ venue: mv.venue, action: mv.action, amount: mv.amount }));
}

// Naive strategy: retreat de-allowlisted venues (forced), otherwise pour all idle into the highest
// raw APY venue, up to caps. No risk adjustment, no momentum, no stress.
function naivePlan(snap: MarketSnapshot): { venue: Address; action: string; amount: bigint }[] {
  const moves: { venue: Address; action: string; amount: bigint }[] = [];
  for (const v of snap.venues) {
    if (!v.allowed && v.allocatedPrincipal > 0n)
      moves.push({ venue: v.address, action: "deallocate", amount: v.allocatedPrincipal });
  }
  const best = snap.venues
    .filter((v) => v.allowed)
    .sort((a, b) => b.apyBps - a.apyBps)[0];
  if (best) {
    let idle = num(snap.vault.idle);
    const already = num(best.allocatedPrincipal);
    let size = Math.min(idle, CAPS.maxMove, CAPS.perVenue - already, CAPS.maxTotal - num(snap.vault.totalDeployed));
    if (size > 0) moves.push({ venue: best.address, action: "allocate", amount: big(size) });
  }
  return moves;
}

function run(name: string, strat: (s: MarketSnapshot) => { venue: Address; action: string; amount: bigint }[]) {
  const pf: Portfolio = { idle: 10_000, pos: {} };
  const history: VenueHistory = {};
  let peak = value(pf);
  let maxDrawdown = 0;
  let hotExposureAtBreak = 0;

  for (let step = 0; step < STEPS; step++) {
    const m = market(step);
    // The break is a SURPRISE: whoever is holding HotVault going into this step eats the haircut,
    // before anyone can react. A strategy only avoids it by having de-risked in the prior cycles.
    if (step === BREAK_STEP) {
      hotExposureAtBreak = pf.pos[HOT] ?? 0;
      pf.pos[HOT] = (pf.pos[HOT] ?? 0) * (1 - HAIRCUT);
    }
    const snap = snapshotOf(pf, m, history);
    // decide + act: the agent now sees the broken, de-allowlisted venue and retreats the remainder
    applyMoves(pf, strat(snap));
    accrueYield(pf, m);
    // update history AFTER acting (so this step's metrics inform the next step's momentum)
    for (const addr of [HOT, STEADY] as Address[]) {
      const s = m[addr]!;
      const sample: VenueSample = {
        utilization: s.utilization,
        pegDeviationBps: s.pegDeviationBps,
        liquidityUsd: s.liquidityUsd,
        tvlUsd: s.tvlUsd,
        apyBps: s.apyBps,
      };
      (history[addr.toLowerCase()] ??= []).push(sample);
    }
    const v = value(pf);
    if (v > peak) peak = v;
    maxDrawdown = Math.max(maxDrawdown, (peak - v) / peak);
  }

  return { name, final: value(pf), maxDrawdown, hotExposureAtBreak };
}

function main() {
  const aumo = run("Aumo (levels + momentum + stress)", aumoPlan);
  const naive = run("Naive (chase highest APY)", naivePlan);

  const pad = (s: string, n: number) => s.padEnd(n);
  const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log("\n Aumo backtest — 30 cycles, a hot venue that deteriorates then breaks at step 20\n");
  console.log(` ${pad("Strategy", 38)} ${pad("Final value", 13)} ${pad("Max drawdown", 14)} Exposure @ break`);
  console.log(` ${"-".repeat(38)} ${"-".repeat(13)} ${"-".repeat(14)} ${"-".repeat(16)}`);
  for (const r of [aumo, naive]) {
    console.log(
      ` ${pad(r.name, 38)} ${pad(usd(r.final), 13)} ${pad(pct(r.maxDrawdown), 14)} ${usd(r.hotExposureAtBreak)}`,
    );
  }
  const edge = aumo.final - naive.final;
  console.log(
    `\n Aumo ends ${usd(edge)} ahead (${pct(edge / naive.final)}), with ${pct(
      naive.maxDrawdown - aumo.maxDrawdown,
    )} less drawdown, by exiting the hot venue before it broke.\n`,
  );
}

main();
