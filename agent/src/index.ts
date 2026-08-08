import { loadConfig } from "./config.js";
import { tick, runLoop } from "./loop.js";
import { buildIdentity, renderBanner } from "./identity.js";

const HELP = `Aumo agent

Usage:
  npm run identity   Print the agent's identity card.
  npm run plan       Sense, score, and reason. Never sends transactions.
  npm run tick       One cycle. Sends transactions only if EXECUTE=1.
  npm run loop       Repeat tick every LOOP_INTERVAL_SECONDS.
`;

async function main() {
  const cmd = process.argv[2] ?? "plan";
  const cfg = loadConfig();

  switch (cmd) {
    case "identity": {
      const id = buildIdentity(cfg);
      console.log(renderBanner(id));
      console.log("\n" + JSON.stringify(id, null, 2));
      break;
    }
    case "plan":
      await tick(cfg, { dryRun: true });
      break;
    case "tick":
      await tick(cfg);
      break;
    case "loop":
      await runLoop(cfg);
      break;
    case "serve": {
      // Hosted mode: expose the status surface, then run the loop alongside it.
      const { startServer } = await import("./server.js");
      startServer(cfg);
      await runLoop(cfg);
      break;
    }
    default:
      console.log(HELP);
      process.exit(cmd === "help" || cmd === "--help" ? 0 : 1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
