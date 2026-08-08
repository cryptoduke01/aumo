import type { Config } from "./config.js";
import { makeClients } from "./chain/client.js";
import { sense } from "./sense/sense.js";
import { buildPlan, type Plan } from "./brain/plan.js";
import { reason } from "./brain/reason.js";
import { execute, type MoveResult } from "./act/execute.js";
import { record } from "./act/receipts.js";
import { buildIdentity, policyFingerprint, renderBanner } from "./identity.js";
import type { MarketSnapshot } from "./types.js";

const fmt = (x: bigint, dec: number) =>
  (Number(x) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: 2 });

function printReport(
  snap: MarketSnapshot,
  plan: Plan,
  exec: MoveResult[] | null,
  fingerprint: string,
) {
  const d = snap.vault.decimals;
  const s = snap.vault.symbol;
  console.log("\n──────────────────────────────────────────────");
  console.log(` Aumo tick · ${snap.takenAt}`);
  console.log("──────────────────────────────────────────────");
  console.log(
    ` Vault ${snap.vault.address}\n idle ${fmt(snap.vault.idle, d)} ${s} · deployed ${fmt(
      snap.vault.totalDeployed,
      d,
    )} ${s}${snap.vault.paused ? " · PAUSED" : ""}`,
  );
  console.log(` policy ${fingerprint.slice(0, 18)}…`);

  console.log("\n Risk engine:");
  for (const r of plan.risks) {
    console.log(
      `  • ${r.name.padEnd(14)} apy ${(r.apyBps / 100).toFixed(2)}%  risk ${(
        r.riskScore * 100
      )
        .toFixed(0)
        .padStart(2)}/100 (${r.band})  → risk-adj ${(r.riskAdjustedApyBps / 100).toFixed(2)}%${
        r.notes.length ? "  [" + r.notes.join("; ") + "]" : ""
      }`,
    );
  }

  console.log(`\n Decision (${plan.source}) — ${plan.regime}/${plan.appetite}:`);
  console.log(`  ${plan.summary}`);
  if (plan.moves.length === 0) {
    console.log("  No moves this tick.");
  } else {
    for (const m of plan.moves) {
      console.log(
        `  → ${m.action.toUpperCase()} ${fmt(m.amount, d)} ${s} ${
          m.action === "allocate" ? "into" : "from"
        } ${m.venueName}`,
      );
      console.log(`     ${m.rationale}`);
    }
  }

  if (exec) {
    console.log("\n Execution:");
    for (const r of exec) {
      console.log(
        `  ${r.status.toUpperCase().padEnd(9)} ${r.move.action} ${r.move.venueName}${
          r.hash ? "  " + r.hash : ""
        }${r.error ? "  " + r.error : ""}`,
      );
    }
  } else {
    console.log("\n Dry-run (EXECUTE=0). No transactions sent.");
  }
  console.log("──────────────────────────────────────────────\n");
}

/** One full cycle: sense → score → reason → (execute) → record. */
export async function tick(cfg: Config, opts: { dryRun?: boolean } = {}): Promise<void> {
  const { publicClient, walletClient, agentAddress } = makeClients(cfg);
  const identity = buildIdentity(cfg);
  const snap = await sense(publicClient, cfg);
  const fingerprint = policyFingerprint(snap.vault, cfg);

  const base = buildPlan(snap, {
    appetite: cfg.appetite,
    regime: "calm",
    maxConcentration: cfg.maxConcentration,
  });
  const plan = await reason(snap, base, cfg);

  const willExecute = cfg.execute && !opts.dryRun;
  let exec: MoveResult[] | null = null;

  if (willExecute) {
    if (!walletClient) throw new Error("EXECUTE=1 but AGENT_PRIVATE_KEY is not set");
    if (agentAddress && agentAddress.toLowerCase() !== snap.vault.agent.toLowerCase()) {
      throw new Error(
        `key ${agentAddress} is not the vault agent ${snap.vault.agent}; refusing to send`,
      );
    }
    if (plan.moves.length > 0) exec = await execute(plan, walletClient, publicClient, cfg.vaultAddress);
  }

  printReport(snap, plan, exec, fingerprint);
  record(snap, plan, exec, { identity, policyFingerprint: fingerprint });
}

/** Repeat a tick every cfg.loopIntervalMs. */
export async function runLoop(cfg: Config): Promise<void> {
  console.log(renderBanner(buildIdentity(cfg)));
  console.log(`\nAumo loop started · interval ${cfg.loopIntervalMs / 1000}s · execute=${cfg.execute}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(cfg);
    } catch (err) {
      console.error("tick error:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, cfg.loopIntervalMs));
  }
}
