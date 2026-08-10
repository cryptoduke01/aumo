import { keccak256, toHex } from "viem";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.js";
import type { VaultState, MarketSnapshot } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANDATE =
  "Put idle stablecoins to work in tokenized real-world-asset yield, within on-chain guardrails, and prove every move.";

function pkgVersion(): string {
  try {
    const p = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    return typeof p.version === "string" ? p.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function gitBuild(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unversioned";
  }
}

export interface AgentIdentity {
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
  policy: { appetite: string; maxConcentration: number; execute: boolean };
}

/** The agent's self-description. Deterministic, no network required. */
export function buildIdentity(cfg: Config): AgentIdentity {
  const agentAddress = cfg.agentPrivateKey
    ? privateKeyToAccount(cfg.agentPrivateKey).address
    : null;
  return {
    name: "Aumo",
    codename: "aumo-agent",
    mandate: MANDATE,
    version: pkgVersion(),
    build: gitBuild(),
    chainId: cfg.chainId,
    chainName: cfg.chainName,
    vault: cfg.vaultAddress,
    agentAddress,
    hasReasoningLayer: Boolean(cfg.anthropicKey),
    policy: {
      appetite: cfg.appetite,
      maxConcentration: cfg.maxConcentration,
      execute: cfg.execute,
    },
  };
}

/**
 * A fingerprint over the exact guardrails governing a decision: the live on-chain
 * caps plus the off-chain policy. Stamped into every receipt so each decision is
 * provably bound to the limits that were in force when it was made — change a cap
 * and the fingerprint changes.
 */
export function policyFingerprint(snap: MarketSnapshot, cfg: Config): string {
  const vault = snap.vault;
  // Fold the sorted venue allowlist into the stamp: the guardrails that matter most (which venues
  // the agent may touch) must change the fingerprint when they change, or the non-repudiation claim
  // ("a decision is bound to the exact policy in force") is false for exactly the part F-1/F-2 make
  // most sensitive. (F-4) The loss-budget params fold in here too once the pool exposes them on-chain
  // (post-redeploy from the fixed source — the current live pool has no maxEpochLoss selector).
  const allowlist = snap.venues
    .filter((v) => v.allowed)
    .map((v) => v.address.toLowerCase())
    .sort();
  const canonical = JSON.stringify({
    chainId: cfg.chainId,
    vault: vault.address.toLowerCase(),
    agent: vault.agent.toLowerCase(),
    maxMoveSize: vault.maxMoveSize.toString(),
    perVenueCap: vault.perVenueCap.toString(),
    maxTotalDeployed: vault.maxTotalDeployed.toString(),
    appetite: cfg.appetite,
    maxConcentration: cfg.maxConcentration,
    allowlist,
  });
  return keccak256(toHex(canonical));
}

const short = (a: string | null) =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "unset";

export function renderBanner(id: AgentIdentity): string {
  return [
    `  ▲ ${id.name} · autonomous treasury agent`,
    `    v${id.version} (build ${id.build}) · ${id.chainName} · vault ${short(id.vault)}`,
    `    agent ${short(id.agentAddress)} · appetite ${id.policy.appetite} · max concentration ${(
      id.policy.maxConcentration * 100
    ).toFixed(0)}%`,
    `    reasoning ${id.hasReasoningLayer ? "on" : "off"} · execute ${
      id.policy.execute ? "on" : "off (dry-run)"
    }`,
    `    mandate: ${id.mandate}`,
  ].join("\n");
}
