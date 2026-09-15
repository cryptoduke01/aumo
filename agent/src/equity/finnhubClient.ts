import { parseUnits, stringToHex, type Hex } from "viem";

/**
 * Finnhub REST client for the SELF-HOSTED equity oracle. This is the market-data source for xStock
 * pricing in the phase before an enterprise price network (Chainlink Data Streams / Supra) is available
 * for equities on X Layer. The off-chain feeder pulls a per-symbol quote and the US market session from
 * Finnhub, converts USD-per-share to 1e18 and the session to the oracle's 24/5 status code, and submits
 * both to SelfHostedEquityOracle via a trusted updater key.
 *
 * TRUST NOTE: this makes Aumo the price source, not a decentralized network. That is disclosed to
 * depositors and is a deliberate, migratable v1 — see SelfHostedEquityOracle. Finnhub's free tier
 * covers real-time US-stock quotes for the handful of large-cap xStocks in the catalog; a secondary
 * source (e.g. a second provider) can be layered in fetchQuote for coverage gaps without any on-chain
 * change. The pure helpers below are exported and unit-tested; only the two network calls need a key.
 */

export interface FinnhubCreds {
  host: string; // e.g. https://finnhub.io
  apiKey: string;
}

export interface Quote {
  priceUsd: number;
  observedAtSec: number; // source's last-trade time (seconds), or now if the source omits it
}

/** Oracle 24/5 market-status codes (must match SelfHostedEquityOracle). */
export const MARKET_STATUS = {
  UNKNOWN: 0,
  PRE: 1,
  REGULAR: 2,
  POST: 3,
  OVERNIGHT: 4,
  CLOSED: 5,
} as const;

/** xStock symbol (e.g. "NVDA") -> the oracle feedId (short ascii right-padded to bytes32). */
export function symbolToFeedId(symbol: string): Hex {
  return stringToHex(symbol, { size: 32 });
}

/** USD per whole share -> 1e18-scaled bigint, matching the oracle's WAD price. */
export function priceToWad(priceUsd: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error(`invalid price ${priceUsd}`);
  }
  return parseUnits(priceUsd.toFixed(8), 18);
}

/**
 * Map Finnhub's `/stock/market-status` fields to the oracle status code. Finnhub reports a `session`
 * ("pre-market" | "regular" | "post-market") and an `isOpen` flag. Anything we can't positively resolve
 * to a tradeable session collapses to CLOSED, so pricing fails CLOSED rather than trading blind — the
 * safe default. (Finnhub does not distinguish an "overnight" session, so overnight reads as CLOSED here;
 * the oracle's overnight opt-in only matters for a source that reports it.)
 */
export function sessionToStatus(session: string | null | undefined, isOpen: boolean): number {
  switch ((session ?? "").toLowerCase()) {
    case "pre-market":
      return MARKET_STATUS.PRE;
    case "regular":
      return MARKET_STATUS.REGULAR;
    case "post-market":
      return MARKET_STATUS.POST;
    default:
      // No named session: trust isOpen if set (regular), else closed.
      return isOpen ? MARKET_STATUS.REGULAR : MARKET_STATUS.CLOSED;
  }
}

export function loadFinnhubCreds(): FinnhubCreds {
  const apiKey = process.env.FINNHUB_API_KEY?.trim();
  const host = process.env.FINNHUB_API_URL?.trim() || "https://finnhub.io";
  if (!apiKey) {
    throw new Error("self-hosted oracle: set FINNHUB_API_KEY (Finnhub market-data key).");
  }
  return { host: host.replace(/\/$/, ""), apiKey };
}

/** Fetch the latest quote for a US ticker. Finnhub `/quote` returns {c: current, t: last-trade sec}. */
export async function fetchQuote(symbol: string, creds: FinnhubCreds): Promise<Quote> {
  const url = `${creds.host}/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${creds.apiKey}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Finnhub quote ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = (await res.json()) as { c?: number; t?: number };
  const price = Number(j?.c);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Finnhub quote for ${symbol} had no usable current price`);
  }
  // Freshness = when WE fetched this live quote, NOT Finnhub's last-trade time `t`. In thin sessions
  // (pre/post-market) `t` can be many hours old even though `c` is the current price, which would make
  // the on-chain staleness guard read the price as stale and freeze the market. Market hours are
  // decided by the session status, not this timestamp, so fetch-time is the correct freshness signal.
  const observedAtSec = Math.floor(Date.now() / 1000);
  return { priceUsd: price, observedAtSec };
}

/** Fetch the US market session and map it to an oracle status code. */
export async function fetchMarketStatus(creds: FinnhubCreds): Promise<number> {
  const url = `${creds.host}/api/v1/stock/market-status?exchange=US&token=${creds.apiKey}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Finnhub market-status ${res.status}: ${text.slice(0, 200)}`);
  }
  const j = (await res.json()) as { isOpen?: boolean; session?: string | null };
  return sessionToStatus(j?.session ?? null, Boolean(j?.isOpen));
}
