import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Address, RiskBand, VenueMeta } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function envOr(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length ? v : fallback;
}

// Defaults target the X Layer testnet deployment so a bare container (e.g. a fresh
// Railway deploy with no vars set) boots into a safe dry-run instead of crashing.
const DEFAULT_RPC = "https://testrpc.xlayer.tech";
const DEFAULT_VAULT = "0x52Fc89beD432e068a0a837065fbCFaDb3573A55e";

function bandFrom(v: string | undefined): RiskBand {
  const b = (v ?? "moderate").toLowerCase();
  if (b === "low" || b === "moderate" || b === "elevated" || b === "high") return b;
  throw new Error(`RISK_APPETITE must be low|moderate|elevated, got "${v}"`);
}

export interface VenueFeedFile {
  chainId: number;
  note?: string;
  venues: VenueMeta[];
}

export interface Config {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  vaultAddress: Address;
  agentPrivateKey?: Address;
  anthropicKey?: string;
  model: string;
  appetite: RiskBand;
  maxConcentration: number;
  loopIntervalMs: number;
  execute: boolean;
  venues: VenueMeta[];
  venuesNote?: string;
}

export function loadConfig(): Config {
  const venuesFile = process.env.VENUES_FILE ?? "testnet";
  const feedPath = join(ROOT, "config", `venues.${venuesFile}.json`);
  const feed = JSON.parse(readFileSync(feedPath, "utf8")) as VenueFeedFile;

  const pk = process.env.AGENT_PRIVATE_KEY?.trim();
  const key =
    pk && pk.length > 0 ? ((pk.startsWith("0x") ? pk : `0x${pk}`) as Address) : undefined;

  return {
    chainId: Number(process.env.CHAIN_ID ?? feed.chainId ?? 1952),
    chainName: process.env.CHAIN_NAME ?? "X Layer Testnet",
    rpcUrl: envOr("RPC_URL", DEFAULT_RPC),
    vaultAddress: envOr("VAULT_ADDRESS", DEFAULT_VAULT) as Address,
    agentPrivateKey: key,
    anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    model: process.env.AUMO_MODEL ?? "claude-sonnet-4-5",
    appetite: bandFrom(process.env.RISK_APPETITE),
    maxConcentration: Number(process.env.MAX_CONCENTRATION ?? "0.6"),
    loopIntervalMs: Number(process.env.LOOP_INTERVAL_SECONDS ?? "900") * 1000,
    execute: (process.env.EXECUTE ?? "0") === "1",
    venues: feed.venues,
    venuesNote: feed.note,
  };
}
