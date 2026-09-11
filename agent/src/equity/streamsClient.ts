import { createHash, createHmac } from "node:crypto";

/**
 * Chainlink Data Streams REST client (MAINNET). The oracle on-chain is pull-based: this fetches a
 * DON-signed report off-chain, and {oracleUpdater} submits it to ChainlinkStreamsEquityOracle, which
 * verifies the signatures on-chain. Auth is HMAC-SHA256 over
 *   `{METHOD} {PATH_WITH_QUERY} {sha256(body)} {apiKey} {timestampMs}`
 * with the API secret, hex-encoded, in three headers. Credentials come from the env; without them the
 * client refuses (the report source is an OKX/Chainlink onboarding, not something to fake).
 *
 * The signing pieces are exported and unit-tested; only the network round trip needs live creds, so
 * confirm end to end against the live Data Streams endpoint before mainnet.
 */

export interface StreamsCreds {
  host: string; // e.g. https://api.dataengine.chain.link (mainnet) / api.testnet-dataengine.chain.link
  apiKey: string;
  apiSecret: string;
}

/** SHA-256 hex of the request body (empty string for GET). */
export function bodyHashHex(body: string): string {
  return createHash("sha256").update(body ?? "").digest("hex");
}

/** The exact string the signature is computed over. */
export function stringToSign(
  method: string,
  pathWithQuery: string,
  bodyHash: string,
  apiKey: string,
  timestampMs: number,
): string {
  return `${method} ${pathWithQuery} ${bodyHash} ${apiKey} ${timestampMs}`;
}

/** HMAC-SHA256(apiSecret, stringToSign), hex-encoded. */
export function hmacHex(apiSecret: string, toSign: string): string {
  return createHmac("sha256", apiSecret).update(toSign).digest("hex");
}

/** The three Data Streams auth headers for a request. */
export function authHeaders(
  method: string,
  pathWithQuery: string,
  body: string,
  apiKey: string,
  apiSecret: string,
  timestampMs: number,
): Record<string, string> {
  const sig = hmacHex(apiSecret, stringToSign(method, pathWithQuery, bodyHashHex(body), apiKey, timestampMs));
  return {
    Authorization: apiKey,
    "X-Authorization-Timestamp": String(timestampMs),
    "X-Authorization-Signature-SHA256": sig,
  };
}

export function loadStreamsCreds(): StreamsCreds {
  const host = process.env.STREAMS_API_URL?.trim();
  const apiKey = process.env.STREAMS_API_KEY?.trim();
  const apiSecret = process.env.STREAMS_API_SECRET?.trim();
  if (!host || !apiKey || !apiSecret) {
    throw new Error(
      "Data Streams not configured: set STREAMS_API_URL, STREAMS_API_KEY, STREAMS_API_SECRET (OKX/Chainlink onboarding).",
    );
  }
  return { host: host.replace(/\/$/, ""), apiKey, apiSecret };
}

/**
 * Fetch the latest signed report for a feed. Returns the `fullReport` hex blob, which is exactly the
 * `payload` argument to the on-chain `updateReport`. `feedId` is the Data Streams feed ID (0x… 32-byte
 * hex), the same id registered on the oracle.
 */
export async function fetchLatestReport(feedId: string, creds: StreamsCreds): Promise<`0x${string}`> {
  const pathWithQuery = `/api/v1/reports/latest?feedID=${feedId}`;
  const ts = Date.now();
  const headers = authHeaders("GET", pathWithQuery, "", creds.apiKey, creds.apiSecret, ts);
  const res = await fetch(`${creds.host}${pathWithQuery}`, { method: "GET", headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Data Streams ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { report?: { fullReport?: string } };
  const full = json?.report?.fullReport;
  if (!full || !full.startsWith("0x")) throw new Error("Data Streams response missing report.fullReport");
  return full as `0x${string}`;
}
