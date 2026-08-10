// Client for the hosted Aumo agent's read-only status API.

export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL ?? "https://aumo-production.up.railway.app";

// Explorer follows the active network (mainnet 196 / testnet 1952).
const EXPLORER =
  process.env.NEXT_PUBLIC_CHAIN === "mainnet"
    ? "https://www.oklink.com/xlayer"
    : "https://www.oklink.com/xlayer-test";
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
  };
  execution: Execution[] | null;
}

export interface Status {
  agent: Identity;
  latest: { takenAt: string } | null;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`agent ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const getStatus = (signal?: AbortSignal) => getJson<Status>("/", signal);
export const getReceipts = (limit = 20, signal?: AbortSignal) =>
  getJson<DecisionRecord[]>(`/receipts?limit=${limit}`, signal);

// Conversational Q&A: ask the agent about its decisions, grounded in its live state.
export async function ask(question: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${AGENT_URL}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
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
