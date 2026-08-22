// Client for the hosted Aumo agent's read-only status API.

import { activeChain } from "./chain";

export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL ?? "https://aumo-production.up.railway.app";

// Explorer follows the active network from the single source of truth (lib/chain.ts), so it can
// never diverge from where the app actually reads and writes. This previously defaulted to the
// testnet explorer on an unset env while chain.ts defaulted to mainnet, sending every "view on
// explorer" link to a 404 on a correct mainnet build.
const EXPLORER = activeChain.blockExplorers?.default.url ?? "https://www.oklink.com/xlayer";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (addr: string) => `${EXPLORER}/address/${addr}`;

export type Band = "low" | "moderate" | "elevated" | "high";

export interface Identity {
  name: string;
  codename: string;
  mandate: string;
  version: string;
  build: string;
  chainId: number;
  chainName: string;
  vault: string;
  agentAddress: string | null;
  hasReasoningLayer: boolean;
  // "turnkey" = signing key sealed in a Turnkey TEE (mainnet); "hotkey" = throwaway key (testnet).
  signer?: "turnkey" | "hotkey";
  policy: { appetite: Band; maxConcentration: number; execute: boolean };
}

export interface VaultSnapshot {
  address: string;
  asset: string;
  owner: string;
  agent: string;
  decimals: number;
  symbol: string;
  idle: string;
  totalDeployed: string;
  maxMoveSize: string;
  perVenueCap: string;
  maxTotalDeployed: string;
  paused: boolean;
}

export interface VenueSnapshot {
  address: string;
  name: string;
  kind: "lending" | "rwa" | "mock";
  apyBps: number;
  tvlUsd: number;
  liquidityUsd: number;
  utilization: number;
  protocolRisk: number;
  pegDeviationBps: number;
  allowed: boolean;
  allocatedPrincipal: string;
  liveBalance: string;
}

export interface VenueRisk {
  address: string;
  name: string;
  apyBps: number;
  riskScore: number;
  band: Band;
  riskAdjustedApyBps: number;
  notes: string[];
}

export interface Move {
  venue: string;
  venueName: string;
  action: "allocate" | "deallocate";
  amount: string;
  rationale: string;
  band: Band;
  riskAdjustedApyBps: number;
}

export interface Execution {
  move: Move;
  hash?: string;
  status: "sent" | "confirmed" | "reverted" | "skipped" | "error";
}

export interface DecisionRecord {
  takenAt: string;
  agent: Identity;
  policyFingerprint: string;
  vault: string;
  snapshot: { takenAt: string; vault: VaultSnapshot; venues: VenueSnapshot[] };
  plan: {
    regime: string;
    appetite: Band;
    source: string;
    summary: string;
    moves: Move[];
    risks: VenueRisk[];
    // Safeguards attached each cycle (present on newer receipts).
    stress?: { fragility: number; recommendedRegime: string; fragileNames: string[] };
    reflection?: { flagged: number; hitRate: number; calibration: number };
    critic?: { approved: boolean; vetoes: string[]; doubt: boolean; concerns: string[] };
    panel?: {
      regime: string;
      vetoes: string[];
      verdicts: { role: string; ok: boolean; concern: number; vetoes: string[]; regime?: string; note: string }[];
    };
  };
  execution: Execution[] | null;
}

export interface Status {
  agent: Identity;
  // True totals over the whole receipts trail (not just the fetched page), so the headline count
  // reflects every decision the agent has recorded, not the display cap.
  decisions?: { total: number; rebalanced: number; held: number };
  latest: { takenAt: string; regime?: string } | null;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`agent ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const getStatus = (signal?: AbortSignal) => getJson<Status>("/", signal);
export const getReceipts = (limit = 20, signal?: AbortSignal) =>
  getJson<DecisionRecord[]>(`/receipts?limit=${limit}`, signal);
// Paged, newest-first: skip the `offset` most recent, return the next `limit`. Lets the Activity feed
// page all the way back through the full trail.
export const getReceiptsPage = (limit: number, offset: number, signal?: AbortSignal) =>
  getJson<DecisionRecord[]>(`/receipts?limit=${limit}&offset=${offset}`, signal);
// The full decision trail as a CSV download (Content-Disposition set server-side).
export const receiptsCsvUrl = `${AGENT_URL}/receipts.csv`;

export interface VenueAttribution {
  address: string;
  name: string;
  accrued: number; // yield currently sitting in this venue, in asset units
  sharePct: number; // share of the total currently-accrued yield, 0..1
}

// Realized-yield attribution and the "beat idle" proof, computed by the agent from its receipts.
export interface Attribution {
  trackedFromTs: string | null;
  latestTs: string | null;
  realizedYieldBps: number | null; // vault price-per-share growth since tracking began (idle = 0)
  annualizedBps: number | null;
  beatIdle: boolean;
  totalAccrued: number; // current sum of per-venue accrued yield, in asset units
  perVenue: VenueAttribution[];
  samples: number;
}

export const getAttribution = (signal?: AbortSignal) =>
  getJson<Attribution>("/attribution", signal);

// Conversational Q&A: ask the agent about its decisions, grounded in its live state. When a
// connected wallet is passed, the agent can also answer the depositor's own position (read on-chain).
export async function ask(question: string, address?: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${AGENT_URL}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(address ? { question, address } : { question }),
    signal,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `ask -> ${res.status}`);
  return data.answer ?? "";
}

// --- formatting ---

export function amount(str: string, decimals: number, maxFrac = 2): string {
  const n = Number(str) / 10 ** decimals;
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
}

export const pct = (bps: number, frac = 2) => `${(bps / 100).toFixed(frac)}%`;
export const short = (a: string | null) =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "-";

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const BAND_COLOR: Record<Band, string> = {
  low: "text-accent",
  moderate: "text-muted-foreground",
  elevated: "text-negative",
  high: "text-negative",
};
