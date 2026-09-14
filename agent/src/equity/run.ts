import "dotenv/config";
import { updateOracleLoop, loadUpdaterConfig } from "./selfHostedOracleUpdater.js";
import { equityLoop } from "./executor.js";
import { loadEquityConfig } from "./config.js";

/**
 * Stocks agent — the single Railway service that keeps the tokenized-stock product running on its own.
 * It runs BOTH long-lived loops concurrently in one process:
 *   1. the self-hosted price feeder (pulls Finnhub quotes, submits them to the oracle), and
 *   2. the multi-pool executor (deploys idle USD₮0 into each stock pool within caps).
 * Prices in, allocation out, no human in the loop. If either loop throws fatally the process exits so
 * Railway restarts it clean, rather than limping along half-alive.
 */
async function main(): Promise<void> {
  const feederCfg = loadUpdaterConfig();
  const execCfg = loadEquityConfig();
  console.log(
    `Aumo stocks agent · feeder(${feederCfg.symbols.length} symbols) + executor(${execCfg.pools.length} pools) · execute=${execCfg.execute}`,
  );
  await Promise.all([updateOracleLoop(feederCfg), equityLoop(execCfg)]);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
