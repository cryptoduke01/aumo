import { existsSync, readFileSync } from "node:fs";
import { RECEIPTS_FILE } from "../act/receipts.js";

/**
 * Realized-yield attribution and the "beat idle" proof, computed from the receipts trail.
 *
 * The honest measure of whether the agent earned its keep is the vault's price per share
 * (totalAssets / totalSupply). Idle capital keeps it flat; the agent's job is to grow it. We record
 * that ratio in every receipt, so its growth since tracking began IS the realized return, net of
 * every swap cost and every move — no simulation, no annualized headline APY. Per-venue attribution
 * shows where the yield currently sits (each venue's live balance above the principal booked in it).
 */

export interface VenueAttribution {
  address: string;
  name: string;
  accrued: number; // liveBalance - allocatedPrincipal, in asset units (yield sitting in this venue)
  sharePct: number; // share of the total currently-accrued yield, 0..1
}

export interface Attribution {
  trackedFromTs: string | null; // first receipt carrying share-price data
  latestTs: string | null;
  pricePerShareStart: number | null; // ratio at tracking start (offset cancels; only growth matters)
  pricePerShareNow: number | null;
  realizedYieldBps: number | null; // (nowPPS / startPPS - 1) in bps — the agent's realized return
  annualizedBps: number | null; // realized, scaled to a year (null until a meaningful window elapses)
  beatIdle: boolean; // realized return is positive (idle would be exactly flat)
  totalAccrued: number; // current sum of per-venue accrued yield, in asset units
  perVenue: VenueAttribution[]; // where the yield currently sits, largest first
  samples: number; // receipts that carried share-price data
}

const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
// Below this elapsed window an annualized figure extrapolates wildly from noise; report null instead.
const MIN_ANNUALIZE_MS = 24 * 60 * 60 * 1000; // 1 day

interface RawReceipt {
  takenAt?: string;
  snapshot?: {
    vault?: { totalAssets?: unknown; totalSupply?: unknown };
    venues?: Array<{
      address?: string;
      name?: string;
      liveBalance?: unknown;
      allocatedPrincipal?: unknown;
    }>;
  };
}

/**
 * Compute attribution from the receipts file. Best-effort: malformed lines are skipped, and receipts
 * predating share-price capture simply don't contribute to the realized-return series.
 */
export function computeAttribution(decimals = 6, file = RECEIPTS_FILE): Attribution {
  const empty: Attribution = {
    trackedFromTs: null,
    latestTs: null,
    pricePerShareStart: null,
    pricePerShareNow: null,
    realizedYieldBps: null,
    annualizedBps: null,
    beatIdle: false,
    totalAccrued: 0,
    perVenue: [],
    samples: 0,
  };
  if (!existsSync(file)) return empty;

  let lines: string[];
  try {
    lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return empty;
  }

  const unit = 10 ** decimals;
  let firstPps: { ts: string; pps: number } | null = null;
  let lastPps: { ts: string; pps: number } | null = null;
  let latest: RawReceipt | null = null;
  let samples = 0;

  for (const line of lines) {
    let rec: RawReceipt;
    try {
      rec = JSON.parse(line) as RawReceipt;
    } catch {
      continue;
    }
    if (rec.takenAt) latest = rec;
    const ta = num(rec.snapshot?.vault?.totalAssets);
    const ts = num(rec.snapshot?.vault?.totalSupply);
    if (ta > 0 && ts > 0 && rec.takenAt) {
      const pps = ta / ts;
      if (!firstPps) firstPps = { ts: rec.takenAt, pps };
      lastPps = { ts: rec.takenAt, pps };
      samples += 1;
    }
  }

  // Per-venue attribution from the latest snapshot: yield currently sitting in each venue.
  const perVenue: VenueAttribution[] = [];
  let totalAccrued = 0;
  for (const v of latest?.snapshot?.venues ?? []) {
    if (!v.address) continue;
    const accrued = (num(v.liveBalance) - num(v.allocatedPrincipal)) / unit;
    if (accrued <= 0) continue; // only attribute positive yield; a venue at a swap-cost loss is not "yield"
    perVenue.push({ address: v.address, name: v.name ?? v.address, accrued, sharePct: 0 });
    totalAccrued += accrued;
  }
  for (const pv of perVenue) pv.sharePct = totalAccrued > 0 ? pv.accrued / totalAccrued : 0;
  perVenue.sort((a, b) => b.accrued - a.accrued);

  if (!firstPps || !lastPps) {
    return { ...empty, latestTs: latest?.takenAt ?? null, totalAccrued, perVenue, samples };
  }

  const realizedYieldBps = (lastPps.pps / firstPps.pps - 1) * 10_000;
  const elapsedMs = Date.parse(lastPps.ts) - Date.parse(firstPps.ts);
  const annualizedBps =
    elapsedMs >= MIN_ANNUALIZE_MS ? realizedYieldBps * (YEAR_MS / elapsedMs) : null;

  return {
    trackedFromTs: firstPps.ts,
    latestTs: lastPps.ts,
    pricePerShareStart: firstPps.pps,
    pricePerShareNow: lastPps.pps,
    realizedYieldBps,
    annualizedBps,
    beatIdle: realizedYieldBps > 0,
    totalAccrued,
    perVenue,
    samples,
  };
}
