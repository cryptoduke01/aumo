import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Address } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

function envOr(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length ? v : fallback;
}

/**
 * Config for the opt-in equity feature. Chain + signer + execute flag are shared with the yield
 * agent's env (RPC_URL / CHAIN_ID / AGENT_PRIVATE_KEY / EXECUTE). The pool/venue/oracle/router
 * addresses come from a `config/equity.<net>.json` file (filled from the DeployEquityPoolTestnet
 * output) or, higher priority, from env overrides so the soak can point at a fresh deploy without
 * editing the file. The equity pool is DIRECTIONAL and separate from the safe pool; nothing here
 * touches the yield loop.
 */
/** One stock's pool + its allowlisted adapter (one pool == one xStock). */
export interface StockVenue {
  symbol: string; // underlying ticker, e.g. "NVDA"
  pool: Address; // the EquityPool
  venue: Address; // the allowlisted EquityAdapter
  venueName: string; // for logs, e.g. "NVDAx"
}

export interface EquityConfig {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  agentPrivateKey?: Address;
  execute: boolean;
  loopIntervalMs: number;

  // The executor drives EVERY pool in `pools` each cycle. Multi-stock mainnet fills it from aligned
  // comma-separated env lists (EQUITY_SYMBOLS / EQUITY_POOLS / EQUITY_VENUES); the single-pool testnet
  // path falls back to one entry from EQUITY_POOL / EQUITY_VENUE.
  pools: StockVenue[];
  pool: Address; // pools[0] — kept for the single-pool callers/tests
  venue: Address; // pools[0].venue
  venueName: string; // pools[0].venueName

  // Testnet soak only: the mocks the feeder drives to move NAV and open/close the market.
  oracle?: Address;
  router?: Address;
  feedId: string; // short ascii, hashed to bytes32 (e.g. "NVDA")
  basePriceUsd: number; // starting price the feeder random-walks around
}

interface EquityFile {
  chainId: number;
  pool: string;
  venue: string;
  venueName?: string;
  oracle?: string;
  router?: string;
  feedId?: string;
  basePriceUsd?: number;
}

function req(name: string, v: string | undefined): string {
  if (!v || !v.trim()) throw new Error(`equity config: ${name} is required (set it in the env or config/equity.<net>.json)`);
  return v.trim();
}

export function loadEquityConfig(): EquityConfig {
  const net = process.env.EQUITY_FILE ?? process.env.VENUES_FILE ?? "testnet";
  let file: EquityFile = { chainId: 1952, pool: "", venue: "" };
  try {
    file = JSON.parse(readFileSync(join(ROOT, "config", `equity.${net}.json`), "utf8")) as EquityFile;
  } catch {
    // no file: rely entirely on env overrides
  }

  const pk = process.env.AGENT_PRIVATE_KEY?.trim();
  const key = pk && pk.length > 0 ? ((pk.startsWith("0x") ? pk : `0x${pk}`) as Address) : undefined;

  // Multi-stock (mainnet): aligned comma-separated lists. Falls back to the single testnet pool.
  const symbols = (process.env.EQUITY_SYMBOLS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const poolList = (process.env.EQUITY_POOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const venueList = (process.env.EQUITY_VENUES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let pools: StockVenue[];
  if (poolList.length > 0) {
    if (venueList.length !== poolList.length) {
      throw new Error("equity config: EQUITY_POOLS and EQUITY_VENUES must be the same length");
    }
    pools = poolList.map((p, i) => ({
      symbol: symbols[i] ?? `S${i}`,
      pool: p as Address,
      venue: venueList[i] as Address,
      venueName: `${symbols[i] ?? "xStock"}x`,
    }));
  } else {
    const pool = req("EQUITY_POOL", process.env.EQUITY_POOL ?? file.pool) as Address;
    const venue = req("EQUITY_VENUE", process.env.EQUITY_VENUE ?? file.venue) as Address;
    pools = [{
      symbol: (process.env.EQUITY_FEED_ID ?? file.feedId ?? "NVDA").toUpperCase(),
      pool,
      venue,
      venueName: process.env.EQUITY_VENUE_NAME ?? file.venueName ?? "xStock",
    }];
  }
  const primary = pools[0];
  if (!primary) throw new Error("equity config: no pools configured");
  const pool = primary.pool;
  const venue = primary.venue;

  return {
    pools,
    chainId: Number(process.env.CHAIN_ID ?? file.chainId ?? 1952),
    chainName: process.env.CHAIN_NAME ?? "X Layer Testnet",
    rpcUrl: envOr("RPC_URL", "https://testrpc.xlayer.tech"),
    agentPrivateKey: key,
    execute: (process.env.EXECUTE ?? "0") === "1",
    loopIntervalMs: Math.max(30, Number(process.env.LOOP_INTERVAL_SECONDS ?? 300)) * 1000,
    pool,
    venue,
    venueName: primary.venueName,
    oracle: (process.env.EQUITY_ORACLE ?? file.oracle) as Address | undefined,
    router: (process.env.EQUITY_ROUTER ?? file.router) as Address | undefined,
    feedId: process.env.EQUITY_FEED_ID ?? file.feedId ?? "NVDA",
    basePriceUsd: Number(process.env.EQUITY_BASE_PRICE ?? file.basePriceUsd ?? 180),
  };
}
