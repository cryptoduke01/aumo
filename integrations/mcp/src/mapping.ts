import { formatUnits } from "viem";
import { ASSET_DECIMALS, txUrl } from "./config.js";
import type { PoolState } from "./chain.js";
import type { CsvDecision, DecisionRecord, Move, StatusResponse, VenueRisk } from "./types.js";

// Pure mappers from the agent API's raw shapes to compact, LLM-friendly results. Raw on-chain
// amounts (base-unit strings) become decimal USDT0 strings, basis points become percentages, and
// 0..1 risk scores become 0..100 so the numbers read the same way the agent's own rationales do.

/** Raw base-unit amount (string or bigint) to a decimal string, or null if absent or malformed. */
export function units(raw: unknown, decimals = ASSET_DECIMALS): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return formatUnits(BigInt(raw as string | bigint), decimals);
  } catch {
    return null;
  }
}

const pct = (bps: unknown): number | null => (typeof bps === "number" && Number.isFinite(bps) ? round(bps / 100, 2) : null);
const score100 = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? round(x * 100, 1) : null);
const r3 = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? round(x, 3) : null);

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

const sameAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const LOOP_STALE_MINUTES = 60; // the agent ticks about every 15 minutes

// ---------------------------------------------------------------------------------- aumo_status

export function mapStatus(
  status: StatusResponse,
  healthOk: boolean,
  now: Date,
  pool: PoolState | { error: string } | null,
) {
  const latest = status.latest ?? null;
  const lastAt = latest?.takenAt ?? null;
  const ageMin = lastAt ? Math.max(0, Math.round((now.getTime() - Date.parse(lastAt)) / 60_000)) : null;
  const a = status.agent ?? {};
  return {
    agentOnline: healthOk,
    decisionLoopActive: ageMin !== null && ageMin <= LOOP_STALE_MINUTES,
    lastDecisionAt: lastAt,
    minutesSinceLastDecision: ageMin,
    decisions: {
      total: status.decisions?.total ?? null,
      rebalanced: status.decisions?.rebalanced ?? null,
      held: status.decisions?.held ?? null,
    },
    latestDecision: latest
      ? {
          takenAt: latest.takenAt ?? null,
          regime: latest.regime ?? null,
          source: latest.source ?? null,
          action: (latest.moves?.length ?? 0) > 0 ? "moved" : "held",
          summary: latest.summary ?? null,
          moves: (latest.moves ?? []).map((m) => compactMove(m)),
        }
      : null,
    agent: {
      name: a.name ?? null,
      chain: a.chainName ?? null,
      chainId: a.chainId ?? null,
      pool: a.vault ?? null,
      agentAddress: a.agentAddress ?? null,
      signer: a.signer ?? null,
      hasReasoningLayer: a.hasReasoningLayer ?? null,
      policy: a.policy ?? null,
    },
    pool:
      pool === null
        ? null
        : "error" in pool
          ? { error: pool.error }
          : {
              totalAssetsUsdt0: units(pool.totalAssets),
              totalShares: units(pool.totalSupply, pool.shareDecimals),
              depositsPaused: pool.paused,
              withdrawalsPaused: false, // AumoPool never pauses exits
            },
  };
}

// ---------------------------------------------------------------------------------- aumo_venues

export function mapVenues(record: DecisionRecord) {
  const snap = record.snapshot ?? {};
  const vault = snap.vault ?? {};
  const dec = vault.decimals ?? ASSET_DECIMALS;
  const risks = record.plan?.risks ?? [];
  const totalAssets = toBig(vault.totalAssets);
  const share = (raw: unknown): number | null => {
    const v = toBig(raw);
    if (v === null || totalAssets === null || totalAssets === 0n) return null;
    return round((Number(v) / Number(totalAssets)) * 100, 2);
  };
  const riskFor = (addr?: string, name?: string): VenueRisk | undefined =>
    risks.find((r) => sameAddr(r.address, addr)) ?? risks.find((r) => r.name === name);

  const venues = (snap.venues ?? []).map((v) => {
    const r = riskFor(v.address, v.name);
    const flags: string[] = [];
    if (r?.dataStale) flags.push("data stale");
    if (r?.redemptionGated) flags.push("redemption gated");
    return {
      name: v.name ?? r?.name ?? null,
      address: v.address ?? r?.address ?? null,
      kind: v.kind ?? null,
      apyPct: pct(r?.apyBps ?? v.apyBps),
      riskAdjustedApyPct: pct(r?.riskAdjustedApyBps),
      riskScore: score100(r?.riskScore),
      riskBand: r?.band ?? null,
      allowlisted: v.allowed ?? null,
      currentValueUsdt0: units(v.liveBalance, dec),
      principalUsdt0: units(v.allocatedPrincipal, dec),
      allocationPct: share(v.liveBalance),
      tvlUsd: typeof v.tvlUsd === "number" ? Math.round(v.tvlUsd) : null,
      exitLiquidityUsd: typeof v.liquidityUsd === "number" ? Math.round(v.liquidityUsd) : null,
      utilizationPct: typeof v.utilization === "number" ? round(v.utilization * 100, 1) : null,
      notes: [...(r?.notes ?? []), ...flags],
    };
  });
  venues.sort((x, y) => (y.riskAdjustedApyPct ?? -1) - (x.riskAdjustedApyPct ?? -1));

  return {
    snapshotAt: snap.takenAt ?? record.takenAt ?? null,
    regime: record.plan?.regime ?? null,
    pool: {
      totalAssetsUsdt0: units(vault.totalAssets, dec),
      idleUsdt0: units(vault.idle, dec),
      idlePct: share(vault.idle),
    },
    venues,
    notes:
      "Sorted by risk-adjusted APY. riskScore is 0 to 100 (lower is safer); riskAdjustedApyPct is the APY after the agent's risk haircut. allocationPct is each venue's share of pool assets at snapshotAt. Only allowlisted venues can ever receive funds; the pool contract enforces that.",
  };
}

// ---------------------------------------------------------------------------------- aumo_decisions

export type DecisionFilter = "all" | "moved" | "held";

export const isMoved = (r: DecisionRecord) => (r.plan?.moves?.length ?? 0) > 0;

export function matchesFilter(r: DecisionRecord, filter: DecisionFilter): boolean {
  if (filter === "all") return true;
  return filter === "moved" ? isMoved(r) : !isMoved(r);
}

function compactMove(m: Move, decimals = ASSET_DECIMALS) {
  return {
    action: m.action ?? null,
    venue: m.venueName ?? m.venue ?? null,
    amountUsdt0: units(m.amount, decimals),
    riskAdjustedApyPct: pct(m.riskAdjustedApyBps),
    band: m.band ?? null,
  };
}

export function mapDecision(r: DecisionRecord) {
  const dec = r.snapshot?.vault?.decimals ?? ASSET_DECIMALS;
  return {
    takenAt: r.takenAt ?? null,
    action: isMoved(r) ? "moved" : "held",
    regime: r.plan?.regime ?? null,
    appetite: r.plan?.appetite ?? null,
    source: r.plan?.source ?? null,
    summary: r.plan?.summary ?? null,
    moves: (r.plan?.moves ?? []).map((m) => compactMove(m, dec)),
    transactions: (r.execution ?? [])
      .filter((e) => e.hash)
      .map((e) => ({ hash: e.hash!, status: e.status ?? null, url: txUrl(e.hash!) })),
  };
}

/** Fallback when a receipt cannot be fetched: the CSV row carries the same headline fields. */
export function mapCsvDecision(row: CsvDecision) {
  const hashes = row.txHashes.split(/\s+/).filter(Boolean);
  return {
    takenAt: row.takenAt,
    action: row.action === "rebalanced" ? "moved" : "held",
    regime: row.regime || null,
    appetite: row.appetite || null,
    source: row.source || null,
    summary: row.rationale || null,
    moves: row.movedInto
      ? row.movedInto.split(" | ").map((venue) => ({ action: null, venue, amountUsdt0: null, riskAdjustedApyPct: null, band: null }))
      : [],
    transactions: hashes.map((hash) => ({ hash, status: null, url: txUrl(hash) })),
  };
}

// ---------------------------------------------------------------------------------- aumo_replay_decision

export function mapReplay(r: DecisionRecord) {
  const plan = r.plan ?? {};
  const vault = r.snapshot?.vault ?? {};
  const dec = vault.decimals ?? ASSET_DECIMALS;
  const u = (raw: unknown) => units(raw, dec);
  const moved = isMoved(r);
  const executions = r.execution ?? [];

  return {
    takenAt: r.takenAt ?? null,
    regime: plan.regime ?? null,
    appetite: plan.appetite ?? null,
    source: plan.source ?? null,
    summary: plan.summary ?? null,
    policyFingerprint: r.policyFingerprint ?? null,
    poolAtDecision: {
      totalAssetsUsdt0: u(vault.totalAssets),
      idleUsdt0: u(vault.idle),
      deployedPrincipalUsdt0: u(vault.totalDeployed),
      depositsPaused: vault.paused ?? null,
      guardrails: {
        maxMoveSizeUsdt0: u(vault.maxMoveSize),
        perVenueCapUsdt0: u(vault.perVenueCap),
        maxTotalDeployedUsdt0: u(vault.maxTotalDeployed),
      },
    },
    riskScores: (plan.risks ?? []).map((k) => ({
      venue: k.name ?? k.address ?? null,
      apyPct: pct(k.apyBps),
      riskAdjustedApyPct: pct(k.riskAdjustedApyBps),
      riskScore: score100(k.riskScore),
      band: k.band ?? null,
      components: {
        protocol: r3(k.protocolRisk),
        liquidity: r3(k.liquidityRisk),
        peg: r3(k.pegRisk),
        utilization: r3(k.utilizationRisk),
        concentration: r3(k.concentrationRisk),
        momentum: r3(k.momentumRisk),
        correlatedExposure: r3(k.correlatedExposure),
      },
      dataStale: k.dataStale ?? null,
      redemptionGated: k.redemptionGated ?? null,
      notes: k.notes ?? [],
    })),
    stressTest: plan.stress
      ? {
          fragility: r3(plan.stress.fragility),
          recommendedRegime: plan.stress.recommendedRegime ?? null,
          fragileVenues: plan.stress.fragileNames ?? [],
          scenarios: (plan.stress.scenarios ?? []).map((s) => ({
            name: s.name ?? null,
            worstBand: s.worstBand ?? null,
            breaches: s.breaches?.length ?? 0,
          })),
          notes: plan.stress.notes ?? [],
        }
      : null,
    reflection: plan.reflection
      ? {
          flaggedPastCalls: plan.reflection.flagged ?? null,
          hitRate: r3(plan.reflection.hitRate),
          calibration: r3(plan.reflection.calibration),
          lessons: plan.reflection.lessons ?? [],
        }
      : null,
    panel: plan.panel
      ? {
          regime: plan.panel.regime ?? null,
          vetoes: plan.panel.vetoes ?? [],
          verdicts: (plan.panel.verdicts ?? []).map((v) => ({
            role: v.role ?? null,
            ok: v.ok ?? null,
            concern: r3(v.concern),
            vetoes: v.vetoes ?? [],
            regime: v.regime ?? null,
            note: v.note ?? null,
          })),
        }
      : null,
    critic: plan.critic
      ? {
          approved: plan.critic.approved ?? null,
          vetoes: plan.critic.vetoes ?? [],
          concerns: plan.critic.concerns ?? [],
          doubt: plan.critic.doubt ?? null,
        }
      : null,
    plan: {
      moves: (plan.moves ?? []).map((m) => ({
        ...compactMove(m, dec),
        riskScore: score100(m.riskScore),
        rationale: m.rationale ?? null,
      })),
      idleBeforeUsdt0: u(plan.idleBefore),
      idleAfterUsdt0: u(plan.idleAfter),
      totalDeployedAfterUsdt0: u(plan.totalDeployedAfter),
    },
    outcome: {
      action: moved ? "moved" : "held",
      executed: executions.length > 0,
      executions: executions.map((e) => ({
        venue: e.move?.venueName ?? e.move?.venue ?? null,
        action: e.move?.action ?? null,
        amountUsdt0: u(e.move?.amount),
        status: e.status ?? null,
        hash: e.hash ?? null,
        url: e.hash ? txUrl(e.hash) : null,
      })),
    },
  };
}

function toBig(raw: unknown): bigint | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return BigInt(raw as string);
  } catch {
    return null;
  }
}

/** Same instant? Compares parsed timestamps so "...48.775Z" and "...48.775+00:00" both match. */
export function sameInstant(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}
