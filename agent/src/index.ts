import { loadConfig } from "./config.js";
import { tick, runLoop } from "./loop.js";

const HELP = `Aumo agent

Usage:
  npm run plan     Sense, score, and reason. Never sends transactions.
  npm run tick     One cycle. Sends transactions only if EXECUTE=1.
  npm run loop     Repeat tick every LOOP_INTERVAL_SECONDS.
`;

async function main() {
  const cmd = process.argv[2] ?? "plan";
  const cfg = loadConfig();

  switch (cmd) {
    case "plan":
      await tick(cfg, { dryRun: true });
      break;
    case "tick":
      await tick(cfg);
      break;
    case "loop":
      await runLoop(cfg);
      break;
    default:
      console.log(HELP);
      process.exit(cmd === "help" || cmd === "--help" ? 0 : 1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
