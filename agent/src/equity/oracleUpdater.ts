import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { streamsOracleAbi } from "./abi.js";
import { fetchLatestReport, loadStreamsCreds, type StreamsCreds } from "./streamsClient.js";

/**
 * MAINNET oracle feeder. The agent is the ChainlinkStreamsEquityOracle `updater`: each cycle it pulls
 * a fresh DON-signed Data Streams report off-chain and submits it via `updateReport`, so on-chain NAV
 * and trade-time reads use a current, verified price with the real market status folded in. This is
 * the mainnet analogue of the testnet {feeder} (which drives mocks). It needs Data Streams credentials
 * (STREAMS_API_URL / STREAMS_API_KEY / STREAMS_API_SECRET) and the oracle address + feed IDs; without
 * them it refuses rather than running blind. Confirm end to end on a fork before mainnet.
 */

interface UpdaterConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  agentPrivateKey?: Address;
  execute: boolean;
  loopIntervalMs: number;
  oracle: Address; // ChainlinkStreamsEquityOracle
  feedIds: string[]; // Data Streams feed IDs (0x… 32-byte hex), each registered on the oracle
  creds: StreamsCreds;
}

function loadUpdaterConfig(): UpdaterConfig {
  const oracle = process.env.EQUITY_STREAMS_ORACLE?.trim();
  if (!oracle) throw new Error("set EQUITY_STREAMS_ORACLE (the ChainlinkStreamsEquityOracle address)");
  const feeds = (process.env.STREAMS_FEED_IDS ?? process.env.STREAMS_FEED_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (feeds.length === 0) throw new Error("set STREAMS_FEED_IDS (comma-separated Data Streams feed IDs)");
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
    feedIds: feeds,
    creds: loadStreamsCreds(),
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

  // Refuse to submit unless our key is actually the oracle's updater (mirrors the executor's guard).
  let wallet;
  let account;
  if (cfg.agentPrivateKey) {
    account = privateKeyToAccount(cfg.agentPrivateKey);
    wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
    const updater = (await pc.readContract({
      address: cfg.oracle,
      abi: streamsOracleAbi,
      functionName: "updater",
    })) as string;
    if (cfg.execute && account.address.toLowerCase() !== updater.toLowerCase()) {
      throw new Error(`key ${account.address} is not the oracle updater ${updater}; refusing to submit`);
    }
  }

  for (const feedId of cfg.feedIds) {
    try {
      const report = await fetchLatestReport(feedId, cfg.creds);
      if (cfg.execute && wallet && account) {
        const hash = await wallet.writeContract({
          account,
          chain,
          address: cfg.oracle,
          abi: streamsOracleAbi,
          functionName: "updateReport",
          args: [report],
        });
        await pc.waitForTransactionReceipt({ hash });
        console.log(`${new Date().toISOString()}  ${feedId}  submitted  ${hash}`);
      } else {
        console.log(`${new Date().toISOString()}  ${feedId}  fetched ${report.slice(0, 18)}…  (dry-run)`);
      }
    } catch (err) {
      console.error(`${feedId}  update failed:`, err instanceof Error ? err.message : err);
    }
  }
}

export async function updateOracleLoop(cfg: UpdaterConfig): Promise<void> {
  console.log(
    `Aumo equity oracle updater · oracle ${cfg.oracle} · ${cfg.feedIds.length} feed(s) · interval ${
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
