// Shapes of the hosted agent's HTTP API (agent/src/server.ts), limited to the fields this server
// reads. Everything is optional because older receipts predate some fields (stress, panel, critic),
// and the mappers must degrade gracefully rather than throw on a missing block.

export type Band = "low" | "moderate" | "elevated" | "high";

export interface Identity {
  name?: string;
  codename?: string;
  mandate?: string;
  version?: string;
  chainId?: number;
  chainName?: string;
  vault?: string;
  agentAddress?: string | null;
  hasReasoningLayer?: boolean;
  signer?: string;
  policy?: { appetite?: Band; maxConcentration?: number; execute?: boolean };
}

/** GET / */
export interface StatusResponse {
  agent?: Identity;
  decisions?: { total?: number; rebalanced?: number; held?: number };
  latest?: {
    takenAt?: string;
    policyFingerprint?: string;
    source?: string;
    regime?: string;
    summary?: string;
    idle?: string;
    deployed?: string;
    symbol?: string;
    moves?: Move[];
  } | null;
}

export interface VaultSnapshot {
  address?: string;
  asset?: string;
  decimals?: number;
  symbol?: string;
  idle?: string;
  totalDeployed?: string;
  totalAssets?: string;
  totalSupply?: string;
  maxMoveSize?: string;
  perVenueCap?: string;
  maxTotalDeployed?: string;
  paused?: boolean;
}

export interface VenueSnapshot {
  address?: string;
  name?: string;
  kind?: string;
  apyBps?: number;
  tvlUsd?: number;
  liquidityUsd?: number;
  utilization?: number;
  pegDeviationBps?: number;
  allowed?: boolean;
  allocatedPrincipal?: string;
  liveBalance?: string;
  note?: string;
  maturityTs?: number;
}

export interface VenueRisk {
  address?: string;
  name?: string;
  apyBps?: number;
  protocolRisk?: number;
  liquidityRisk?: number;
  pegRisk?: number;
  utilizationRisk?: number;
  concentrationRisk?: number;
  momentumRisk?: number;
  correlatedExposure?: number;
  dataStale?: boolean;
  redemptionGated?: boolean;
  riskScore?: number;
  band?: Band;
  riskAdjustedApyBps?: number;
  notes?: string[];
}

export interface Move {
  venue?: string;
  venueName?: string;
  action?: "allocate" | "deallocate" | string;
  amount?: string;
  rationale?: string;
  band?: Band;
  riskScore?: number;
  riskAdjustedApyBps?: number;
}

export interface Execution {
  move?: Move;
  hash?: string;
  status?: string;
}

export interface Stress {
  fragility?: number;
  recommendedRegime?: string;
  fragileNames?: string[];
  scenarios?: { name?: string; worstBand?: Band; breaches?: unknown[] }[];
  notes?: string[];
}

export interface Reflection {
  flagged?: number;
  hits?: number;
  hitRate?: number;
  calibration?: number;
  lessons?: unknown[];
}

export interface Critic {
  approved?: boolean;
  vetoes?: string[];
  concerns?: string[];
  doubt?: boolean;
}

export interface Panel {
  regime?: string;
  vetoes?: string[];
  verdicts?: { role?: string; ok?: boolean; concern?: number; vetoes?: string[]; regime?: string; note?: string }[];
}

/** One element of GET /receipts */
export interface DecisionRecord {
  takenAt?: string;
  policyFingerprint?: string;
  vault?: string;
  snapshot?: { takenAt?: string; vault?: VaultSnapshot; venues?: VenueSnapshot[] };
  plan?: {
    regime?: string;
    appetite?: Band;
    source?: string;
    summary?: string;
    moves?: Move[];
    risks?: VenueRisk[];
    idleBefore?: string;
    idleAfter?: string;
    totalDeployedAfter?: string;
    stress?: Stress;
    reflection?: Reflection;
    critic?: Critic;
    panel?: Panel;
  };
  execution?: Execution[] | null;
}

/** One row of GET /receipts.csv (header names from decisionsCsv in agent/src/server.ts). */
export interface CsvDecision {
  takenAt: string;
  regime: string;
  appetite: string;
  source: string;
  action: string; // "rebalanced" | "held"
  moveCount: number;
  movedInto: string;
  rationale: string;
  txHashes: string;
}
