// End-to-end smoke test: spawn the server over stdio exactly as an MCP client would, then call
// tools against the live agent API and X Layer RPC. Read-only; nothing is signed or sent.
//
//   npm run smoke            aumo_status + aumo_venues
//   npm run smoke -- --all   every tool (aumo_ask makes one real question to the agent)

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const all = process.argv.includes("--all");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", join(root, "src/index.ts")],
  cwd: root,
  env: { ...(process.env as Record<string, string>) },
  stderr: "inherit",
});
const client = new Client({ name: "aumo-smoke", version: "0.0.0" });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown> = {}) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
  const ms = Date.now() - t0;
  if (res.isError) {
    console.log(`\n# ${name} ${JSON.stringify(args)} -> ERROR (${ms} ms)\n${text}`);
    return null;
  }
  console.log(`\n# ${name} ${JSON.stringify(args)} (${ms} ms)`);
  return JSON.parse(text);
}

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);

const status = await call("aumo_status");
if (status) {
  console.log(
    JSON.stringify(
      {
        agentOnline: status.agentOnline,
        decisionLoopActive: status.decisionLoopActive,
        lastDecisionAt: status.lastDecisionAt,
        minutesSinceLastDecision: status.minutesSinceLastDecision,
        decisions: status.decisions,
        regime: status.latestDecision?.regime,
        summary: status.latestDecision?.summary,
        pool: status.pool,
      },
      null,
      2,
    ),
  );
}

const venues = await call("aumo_venues");
if (venues) {
  console.log(`snapshotAt ${venues.snapshotAt}, regime ${venues.regime}, pool ${JSON.stringify(venues.pool)}`);
  for (const v of venues.venues) {
    console.log(
      `  ${v.name}: APY ${v.apyPct}% | risk-adj ${v.riskAdjustedApyPct}% | risk ${v.riskScore}/100 ${v.riskBand} | allowlisted ${v.allowlisted} | value ${v.currentValueUsdt0} USDT0 (${v.allocationPct}%)`,
    );
  }
}

if (all) {
  const moved = await call("aumo_decisions", { filter: "moved", limit: 2 });
  if (moved) {
    console.log(`totalMovedAllTime ${moved.totalMovedAllTime}`);
    for (const d of moved.decisions) console.log(`  ${d.takenAt} ${d.action} ${JSON.stringify(d.moves)} txs=${d.transactions.length}`);
  }
  const recent = await call("aumo_decisions", { limit: 3 });
  if (recent) for (const d of recent.decisions) console.log(`  ${d.takenAt} ${d.action} ${d.regime}`);

  const target = moved?.decisions?.[0]?.takenAt;
  const replay = await call("aumo_replay_decision", target ? { takenAt: target } : {});
  if (replay) {
    console.log(
      JSON.stringify(
        {
          takenAt: replay.takenAt,
          regime: replay.regime,
          riskScores: replay.riskScores.length,
          stress: replay.stressTest && { fragility: replay.stressTest.fragility, recommendedRegime: replay.stressTest.recommendedRegime },
          panel: replay.panel?.verdicts?.map((v: { role: string; ok: boolean }) => `${v.role}:${v.ok}`),
          critic: replay.critic,
          outcome: replay.outcome,
        },
        null,
        2,
      ),
    );
  }

  const agentAddr = status?.agent?.agentAddress ?? "0x2647904345d00Ef30d831935b913E5df1D58af67";
  const pos = await call("aumo_position", { address: agentAddr });
  if (pos) console.log(JSON.stringify(pos, null, 2));

  const dep = await call("aumo_prepare_deposit", { from: agentAddr, amount: "1" });
  if (dep) {
    console.log(`steps: ${dep.transactions.map((t: { step: number; kind: string; to: string }) => `${t.step}:${t.kind}->${t.to}`).join(", ")}`);
    console.log(`expectedShares ${dep.expectedShares}; dryRun: ${dep.dryRun}; warnings: ${JSON.stringify(dep.warnings)}`);
  }

  const wd = await call("aumo_prepare_withdraw", { owner: agentAddr, amount: "0.5" });
  if (wd) console.log(`mode ${wd.mode}; dryRun: ${wd.dryRun}; warnings: ${JSON.stringify(wd.warnings)}`);
  await call("aumo_prepare_withdraw", { owner: agentAddr, amount: "max" });

  const ask = await call("aumo_ask", { question: "In one sentence, where does your yield come from?" });
  if (ask) console.log(ask.answer);
}

await client.close();
