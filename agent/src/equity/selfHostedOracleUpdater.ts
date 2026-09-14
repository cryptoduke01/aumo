import "dotenv/config";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { selfHostedOracleAbi } from "./abi.js";
import {
  fetchMarketStatus,
  fetchQuote,
  loadFinnhubCreds,
  priceToWad,
  symbolToFeedId,
  type FinnhubCreds,
} from "./finnhubClient.js";

/**
 * SELF-HOSTED oracle feeder. The agent is the SelfHostedEquityOracle `updater`: each cycle it pulls a
 * fresh quote per xStock from Finnhub, resolves the US market session, and submits the batch via
 * `submitPrices`, so on-chain NAV and trade-time reads use a current price with the real market status
 * folded in. This is the source we run while an enterprise price network (Chainlink Data Streams /
 * Supra) is not yet available for equities on X Layer; consumers read the oracle-agnostic IEquityOracle,
 * so swapping to that network later is a single `setOracle` on the adapter, no depositor action.
 *
 * It needs FINNHUB_API_KEY, SELF_HOSTED_EQUITY_ORACLE, and EQUITY_SYMBOLS; without them it refuses
 * rather than running blind. Only quotes strictly newer than what is already stored are submitted, so a
 * closed market (unchanged last-trade time) costs no transaction.
 */

interface UpdaterConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  agentPrivateKey?: Address;
  execute: boolean;
  loopIntervalMs: number;
  oracle: Address; // SelfHostedEquityOracle
  symbols: string[]; // US tickers, each registered on the oracle as bytes32(symbol)
  creds: FinnhubCreds;
}

function loadUpdaterConfig(): UpdaterConfig {
  const oracle = process.env.SELF_HOSTED_EQUITY_ORACLE?.trim();
  if (!oracle) throw new Error("set SELF_HOSTED_EQUITY_ORACLE (the SelfHostedEquityOracle address)");
  const symbols = (process.env.EQUITY_SYMBOLS ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length === 0) throw new Error("set EQUITY_SYMBOLS (comma-separated US tickers, e.g. NVDA,TSLA,AAPL)");
  const pk = process.env.AGENT_PRIVATE_KEY?.trim();
  const key = pk && pk.length > 0 ? ((pk.startsWith("0x") ? pk : `0x${pk}`) as Address) : undefined;

  return {
    chainId: Number(process.env.CHAIN_ID ?? 196),
    chainName: process.env.CHAIN_NAME ?? "X Layer",
    rpcUrl: process.env.RPC_URL?.trim() || "https://rpc.xlayer.tech",
    agentPrivateKey: key,
    execute: (process.env.EXECUTE ?? "0") === "1",
    loopIntervalMs: Math.max(30, Number(process.env.LOOP_INTERVAL_SECONDS ?? 60)) * 1000,
    oracle: oracle as Address,
    symbols,
    creds: loadFinnhubCreds(),
  };
}

export async function updateOracleOnce(cfg: UpdaterConfig): Promise<void> {
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  let wallet;
  let account;
  if (cfg.agentPrivateKey) {
    account = privateKeyToAccount(cfg.agentPrivateKey);
    wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
    const updater = (await pc.readContract({
      address: cfg.oracle,
      abi: selfHostedOracleAbi,
      functionName: "updater",
    })) as string;
    if (cfg.execute && account.address.toLowerCase() !== updater.toLowerCase()) {
      throw new Error(`key ${account.address} is not the oracle updater ${updater}; refusing to submit`);
    }
  }

  // One market-status read per cycle (it applies to every US equity).
  const status = await fetchMarketStatus(cfg.creds);

  const feedIds: Hex[] = [];
  const pricesWad: bigint[] = [];
  const statuses: number[] = [];
  const timestamps: number[] = [];

  for (const symbol of cfg.symbols) {
    try {
      const feedId = symbolToFeedId(symbol);
      const quote = await fetchQuote(symbol, cfg.creds);
      // Skip anything not strictly newer than what is stored: the on-chain monotonic guard would reject
      // it, so sending it would only waste a reverted transaction.
      const [lastObs] = (await pc.readContract({
        address: cfg.oracle,
        abi: selfHostedOracleAbi,
        functionName: "lastObservation",
        args: [feedId],
      })) as [number, number];
      if (quote.observedAtSec <= Number(lastObs)) {
        console.log(`${new Date().toISOString()}  ${symbol}  no newer quote (last ${lastObs}) — skip`);
        continue;
      }
      feedIds.push(feedId);
      pricesWad.push(priceToWad(quote.priceUsd));
      statuses.push(status);
      timestamps.push(quote.observedAtSec);
    } catch (err) {
      console.error(`${symbol}  quote failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (feedIds.length === 0) {
    console.log(`${new Date().toISOString()}  nothing new to submit (status ${status})`);
    return;
  }

  if (cfg.execute && wallet && account) {
    const hash = await wallet.writeContract({
      account,
      chain,
      address: cfg.oracle,
      abi: selfHostedOracleAbi,
      functionName: "submitPrices",
      args: [feedIds, pricesWad, statuses, timestamps],
    });
    await pc.waitForTransactionReceipt({ hash });
    console.log(`${new Date().toISOString()}  submitted ${feedIds.length} quote(s)  status ${status}  ${hash}`);
  } else {
    const preview = cfg.symbols.slice(0, feedIds.length).join(",");
    console.log(
      `${new Date().toISOString()}  would submit ${feedIds.length} quote(s) [${preview}]  status ${status}  (dry-run)`,
    );
  }
}

export async function updateOracleLoop(cfg: UpdaterConfig): Promise<void> {
  console.log(
    `Aumo self-hosted equity oracle updater · oracle ${cfg.oracle} · ${cfg.symbols.length} symbol(s) · interval ${
      cfg.loopIntervalMs / 1000
    }s · execute=${cfg.execute}`,
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await updateOracleOnce(cfg).catch((err) =>
      console.error("updater cycle error:", err instanceof Error ? err.message : err),
    );
    await new Promise((r) => setTimeout(r, cfg.loopIntervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] ?? "loop";
  const cfg = loadUpdaterConfig();
  (cmd === "once" ? updateOracleOnce(cfg) : updateOracleLoop(cfg)).catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
