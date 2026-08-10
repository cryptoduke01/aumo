import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { MarketSnapshot } from "../types.js";
import type { Plan } from "../brain/plan.js";
import type { MoveResult } from "./execute.js";
import type { AgentIdentity } from "../identity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The receipt trail is the product's proof of every move, so it must survive restarts. In a
// container with an ephemeral filesystem (e.g. Railway with no volume) the default in-repo path is
// wiped on every redeploy — set RECEIPTS_DIR to a mounted persistent volume (e.g. /data) to keep the
// history. Reader (server.ts) resolves the same env, so they always agree.
export const RECEIPTS_DIR =
  process.env.RECEIPTS_DIR?.trim() || join(__dirname, "..", "..", "receipts");
export const RECEIPTS_FILE = join(RECEIPTS_DIR, "decisions.jsonl");

const jsonSafe = (x: unknown) =>
  JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

/**
 * The off-chain audit trail. Each tick appends one record — the inputs the agent
 * saw, the risk scores it computed, the plan and its rationale, and the resulting
 * transaction hashes. The chain holds the receipts; this holds the reasoning that
 * produced them. Together they make every move explainable after the fact.
 */
export interface DecisionRecord {
  takenAt: string;
  agent: AgentIdentity;
  policyFingerprint: string;
  vault: string;
  snapshot: unknown;
  plan: unknown;
  execution: unknown;
}

export function record(
  snap: MarketSnapshot,
  plan: Plan,
  execution: MoveResult[] | null,
  ctx: { identity: AgentIdentity; policyFingerprint: string },
): DecisionRecord {
  const rec: DecisionRecord = {
    takenAt: snap.takenAt,
    agent: ctx.identity,
    policyFingerprint: ctx.policyFingerprint,
    vault: snap.vault.address,
    snapshot: jsonSafe(snap),
    plan: jsonSafe(plan),
    execution: execution ? jsonSafe(execution) : null,
  };
  mkdirSync(RECEIPTS_DIR, { recursive: true });
  appendFileSync(RECEIPTS_FILE, JSON.stringify(rec) + "\n");
  return rec;
}
