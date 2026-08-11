import type { Config } from "./config.js";
import { makeClients } from "./chain/client.js";
import { sense } from "./sense/sense.js";
import { buildPlan, type Plan } from "./brain/plan.js";
import { reason } from "./brain/reason.js";
import { stressTest } from "./risk/stress.js";
import { readDepositorAppetite } from "./sense/appetite.js";
import { reflect } from "./brain/reflect.js";
import { critique } from "./brain/critic.js";
import { BAND_RANK } from "./risk/engine.js";
import type { Address } from "viem";
import { execute, type MoveResult } from "./act/execute.js";
import { record, loadHistory } from "./act/receipts.js";
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

  if (plan.stress) {
    const st = plan.stress;
    console.log(
      `\n Stress test: fragility ${(st.fragility * 100).toFixed(0)}% · regime ceiling ${
        st.recommendedRegime
      }${st.fragileNames.length ? ` · fragile: ${st.fragileNames.join(", ")}` : " · none fragile"}`,
    );
  }
  if (plan.reflection && plan.reflection.flagged > 0) {
    const rf = plan.reflection;
    console.log(
      ` Reflection: momentum ${rf.hits}/${rf.flagged} predictive (${(rf.hitRate * 100).toFixed(
        0,
      )}%) · calibration ${rf.calibration.toFixed(2)}x`,
    );
  }
  if (plan.critic && (plan.critic.vetoes.length > 0 || plan.critic.doubt)) {
    console.log(
      ` Critic: ${plan.critic.doubt ? "HOLD (doubt)" : `${plan.critic.vetoes.length} veto(es)`} — ${plan.critic.concerns.join(
        " ",
      )}`,
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
  // Attach recent per-venue history so the risk engine can penalise deteriorating venues (temporal
  // awareness). Prior receipts are the source; a fresh trail simply scores on levels.
  snap.history = loadHistory(6);
  // Reflection: grade past trend calls and self-calibrate how much momentum bites (tighten-only).
  const reflection = reflect(snap.history);
  snap.momentumCalibration = reflection.calibration;
  const fingerprint = policyFingerprint(snap, cfg);

  // Collective risk steering: depositors' share-weighted appetite, clamped to the owner's hard
  // ceiling. Depositors can only steer the pool MORE conservative than the configured max.
  const depositorAppetite = await readDepositorAppetite(publicClient, cfg.vaultAddress as Address);
  const appetite =
    depositorAppetite && BAND_RANK[depositorAppetite.band] < BAND_RANK[cfg.appetite]
      ? depositorAppetite.band
      : cfg.appetite;

  // Provisional plan (what we'd do with no stress constraints), then stress-test the portfolio it
  // would create. Fragile venues are denied new deploys and broad fragility pulls the regime down;
  // the base plan is rebuilt under those constraints before the LLM adds any further caution.
  const provisional = buildPlan(snap, {
    appetite,
    regime: "calm",
    maxConcentration: cfg.maxConcentration,
  });
  const stress = stressTest(snap, provisional, appetite);
  const stressDeny = new Set(stress.fragile);
  const base = buildPlan(snap, {
    appetite,
    regime: stress.recommendedRegime,
    maxConcentration: cfg.maxConcentration,
    deny: stressDeny,
  });
  base.stress = stress;
  base.reflection = reflection;
  const reasoned = await reason(snap, base, cfg, stressDeny);
  // Final adversarial gate: the critic tries to break the plan and can veto allocations or, on a
  // serious worry, hold the cycle. It only ever removes risk — retreats are never blocked.
  const plan = critique(snap, reasoned);

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
