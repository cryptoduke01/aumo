import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAddress } from "viem";
import type { Config } from "./config.js";
import type { Address, VenueMeta } from "./types.js";

/**
 * x402 (v2) seller side for Aumo's paid endpoints, so other agents can pay per call in USDT0 on X Layer.
 *
 * Wire format (matches the OKX Agent Payments Protocol client and the x402 v2 reference):
 *  - Unpaid request: HTTP 402, `PAYMENT-REQUIRED` header = base64(JSON PaymentRequired). The same JSON
 *    is also the response body so a human with curl can read it.
 *  - Paid request: the client replays with `PAYMENT-SIGNATURE` = base64(JSON PaymentPayload). The legacy
 *    v1 header name `X-PAYMENT` is accepted as a carrier too, but the payload itself must be v2.
 *  - On success: HTTP 200 plus `PAYMENT-RESPONSE` = base64(JSON settle response from the facilitator).
 *
 * Verification and settlement go through an x402 facilitator (POST /verify, POST /settle): OKX's hosted
 * one on X Layer (signed with an OKX Web3 API key, OKX pays the gas) or any standard facilitator URL. We
 * settle only AFTER the paid work has succeeded, and only send the paid body once settlement succeeds,
 * so a caller is never charged for a failed call and never gets the content without paying.
 */

export const X402_VERSION = 2;
export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_X_PAYMENT = "X-PAYMENT";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

// USDT0 is a 6-decimal token (same convention as readYou/readYourEquity in server.ts).
export const ASSET_DECIMALS = 6;
export const DEFAULT_PRICE = "0.01";
// EIP-712 domain of USDT0 on X Layer (0x779D...3736, chain 196), needed by the `exact` scheme's
// EIP-3009 transferWithAuthorization. Verified on-chain: name() returns "USD₮0"; the token has no
// version() getter, and its DOMAIN_SEPARATOR matches only version "1" (not the client default "2").
export const DEFAULT_ASSET_EIP712_NAME = "USD₮0";
export const DEFAULT_ASSET_EIP712_VERSION = "1";
// How long the buyer's signed authorization stays valid. Covers a model call plus settlement.
export const MAX_TIMEOUT_SECONDS = 120;

// OKX's hosted x402 facilitator (Agent Payments Protocol). Requests are signed with an OKX Web3 API key.
export const OKX_FACILITATOR_URL = "https://web3.okx.com/api/v6/pay/x402";

const VERIFY_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 60_000;

export interface X402Config {
  network: string; // CAIP-2, e.g. "eip155:196"
  asset: Address;
  assetName: string; // EIP-712 domain name of the asset
  assetVersion: string; // EIP-712 domain version of the asset
  payTo: Address;
  price: string; // human, e.g. "0.01"
  amount: string; // base units, e.g. "10000"
  facilitatorUrl: string; // no trailing slash
  facilitatorAuth?: OkxAuth; // set when the facilitator is OKX's: every call is HMAC-signed
  publicUrl?: string; // optional public base URL used in `resource.url`; no trailing slash
  maxTimeoutSeconds: number;
}

export interface OkxAuth {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export type X402Setup = { enabled: true; config: X402Config } | { enabled: false; reason: string };

/**
 * The pool's base asset, read from the venue config rather than hardcoded: every `lending` venue is a
 * base-asset-denominated position (Aave USDT0, spUSDT), so their shared `underlying` is the asset.
 * Returns undefined when it is absent or ambiguous (e.g. the testnet mock set), which keeps the paid
 * routes off rather than quoting a guessed token.
 */
export function baseAssetFrom(venues: VenueMeta[]): Address | undefined {
  const seen = new Set<string>();
  for (const v of venues) {
    if (v.kind !== "lending") continue;
    const u = v.underlying ?? (v.feed?.source === "aave" ? v.feed.underlying : undefined);
    if (u && isAddress(u)) seen.add(u);
  }
  if (seen.size !== 1) return undefined;
  const [only] = [...seen];
  return only as Address;
}

/** "0.01" -> "10000" at 6 decimals. Null for anything malformed, over-precise, or not positive. */
export function toBaseUnits(price: string, decimals: number): string | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  const units = BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  return units > 0n ? units.toString() : null;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/**
 * Resolve the paid-route config from env. Fails closed: if anything required is missing or invalid the
 * paid routes stay disabled (404) and nothing else about the server changes.
 */
export function loadX402(cfg: Config, env: NodeJS.ProcessEnv = process.env): X402Setup {
  const payTo = env.X402_PAY_TO?.trim();
  const okx = okxAuthFrom(env);
  if (okx === "partial") {
    return { enabled: false, reason: "set all three of OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE, or none" };
  }
  // With OKX credentials and no explicit URL, use OKX's hosted facilitator.
  const facilitator = env.X402_FACILITATOR_URL?.trim() || (okx ? OKX_FACILITATOR_URL : undefined);
  if (!payTo || !facilitator) {
    return {
      enabled: false,
      reason: "X402_PAY_TO must be set, plus OKX_API_KEY/OKX_SECRET_KEY/OKX_PASSPHRASE or X402_FACILITATOR_URL",
    };
  }
  if (!isAddress(payTo) || /^0x0{40}$/i.test(payTo)) {
    return { enabled: false, reason: "X402_PAY_TO is not a valid non-zero address" };
  }
  let facilitatorUrl: string;
  try {
    const u = new URL(facilitator);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
    facilitatorUrl = trimSlash(u.toString());
  } catch {
    return { enabled: false, reason: "X402_FACILITATOR_URL is not a valid http(s) URL" };
  }
  const isOkx = new URL(facilitatorUrl).hostname === new URL(OKX_FACILITATOR_URL).hostname;
  if (isOkx && !okx) {
    return { enabled: false, reason: "the OKX facilitator needs OKX_API_KEY, OKX_SECRET_KEY and OKX_PASSPHRASE" };
  }
  const price = env.X402_PRICE?.trim() || DEFAULT_PRICE;
  const amount = toBaseUnits(price, ASSET_DECIMALS);
  if (!amount) {
    return { enabled: false, reason: `X402_PRICE "${price}" is not a positive amount with at most ${ASSET_DECIMALS} decimals` };
  }
  const asset = baseAssetFrom(cfg.venues);
  if (!asset) {
    return { enabled: false, reason: "no single base asset (USDT0) found in the venue config" };
  }
  const publicUrl = env.X402_PUBLIC_URL?.trim();
  return {
    enabled: true,
    config: {
      network: `eip155:${cfg.chainId}`,
      asset,
      assetName: env.X402_ASSET_EIP712_NAME?.trim() || DEFAULT_ASSET_EIP712_NAME,
      assetVersion: env.X402_ASSET_EIP712_VERSION?.trim() || DEFAULT_ASSET_EIP712_VERSION,
      payTo: payTo as Address,
      price,
      amount,
      facilitatorUrl,
      facilitatorAuth: isOkx && okx ? okx : undefined,
      publicUrl: publicUrl ? trimSlash(publicUrl) : undefined,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    },
  };
}

/** OKX Web3 API credentials from env: all three, none (undefined), or a partial set (an error). */
function okxAuthFrom(env: NodeJS.ProcessEnv): OkxAuth | undefined | "partial" {
  const apiKey = env.OKX_API_KEY?.trim();
  const secretKey = env.OKX_SECRET_KEY?.trim();
  const passphrase = env.OKX_PASSPHRASE?.trim();
  const set = [apiKey, secretKey, passphrase].filter(Boolean).length;
  if (set === 0) return undefined;
  if (set < 3) return "partial";
  return { apiKey: apiKey!, secretKey: secretKey!, passphrase: passphrase! };
}

/**
 * OKX API request signing: base64(HMAC-SHA256(secret, timestamp + METHOD + requestPath + body)), with an
 * ISO-8601 millisecond timestamp. Same scheme as OKX's own x402 SDK (OKXFacilitatorClient).
 */
export function okxHeaders(auth: OkxAuth, method: "GET" | "POST", requestPath: string, body = "", now = new Date()) {
  const timestamp = now.toISOString();
  const sign = createHmac("sha256", auth.secretKey).update(timestamp + method + requestPath + body).digest("base64");
  return {
    "OK-ACCESS-KEY": auth.apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": auth.passphrase,
  };
}

// --- wire types ----------------------------------------------------------------------------------

export interface ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

/** The standard v2 payment terms. This exact object is what we send to the facilitator. */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
}

/**
 * Bazaar-style description of how to call the resource. The OKX client reads `outputSchema.input` from
 * an `accepts[]` entry to learn the replay method and body params (so a GET probe of a POST endpoint
 * still gets a usable quote). It is advertised only; it is never sent to the facilitator.
 */
export interface OutputSchema {
  input: {
    type: "http";
    method: "GET" | "POST";
    bodyType?: "json";
    body?: Record<string, unknown>;
  };
  output?: Record<string, unknown>;
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: Array<PaymentRequirements & { outputSchema?: OutputSchema }>;
}

export interface PaidRoute {
  path: string;
  description: string;
  outputSchema?: OutputSchema;
}

export function requirementsFor(x: X402Config): PaymentRequirements {
  return {
    scheme: "exact",
    network: x.network,
    amount: x.amount,
    asset: x.asset,
    payTo: x.payTo,
    maxTimeoutSeconds: x.maxTimeoutSeconds,
    extra: { name: x.assetName, version: x.assetVersion },
  };
}

/** Absolute URL of the paid resource: X402_PUBLIC_URL when set, else derived from the request. */
export function resourceUrl(req: IncomingMessage, x: X402Config, path: string): string {
  if (x.publicUrl) return `${x.publicUrl}${path}`;
  const fwd = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() || "http";
  const host = req.headers.host || "localhost";
  return `${proto}://${host}${path}`;
}

export function buildPaymentRequired(
  x: X402Config,
  route: PaidRoute,
  url: string,
  error?: string,
): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    ...(error ? { error } : {}),
    resource: { url, description: route.description, mimeType: "application/json" },
    accepts: [{ ...requirementsFor(x), ...(route.outputSchema ? { outputSchema: route.outputSchema } : {}) }],
  };
}

export const encodeHeader = (obj: unknown): string => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");

/** The client's payment header: `PAYMENT-SIGNATURE` (v2), else the legacy `X-PAYMENT` name. */
export function readPaymentHeader(req: IncomingMessage): string | undefined {
  for (const name of [HEADER_PAYMENT_SIGNATURE, HEADER_X_PAYMENT]) {
    const v = req.headers[name.toLowerCase()];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    if (s) return s;
  }
  return undefined;
}

export interface PaymentPayloadV2 {
  x402Version: 2;
  accepted: Record<string, unknown>;
  payload: Record<string, unknown>;
  resource?: unknown;
  extensions?: unknown;
}

type Decoded = { ok: true; payload: PaymentPayloadV2 } | { ok: false; reason: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** base64 (or base64url) JSON -> a structurally valid v2 PaymentPayload, or a reason it is not. */
export function decodePaymentHeader(raw: string): Decoded {
  if (raw.length > 16_384 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
    return { ok: false, reason: "invalid_payment_header" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_payment_header" };
  }
  if (!isObj(parsed)) return { ok: false, reason: "invalid_payment_header" };
  if (parsed.x402Version !== X402_VERSION) return { ok: false, reason: "unsupported_x402_version" };
  if (!isObj(parsed.accepted) || !isObj(parsed.payload)) return { ok: false, reason: "invalid_payment_payload" };
  return { ok: true, payload: parsed as unknown as PaymentPayloadV2 };
}

const sameAddr = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** The terms the buyer signed must be exactly the terms we quoted. Checked locally before any facilitator call. */
export function matchesRequirements(accepted: Record<string, unknown>, req: PaymentRequirements): boolean {
  return (
    accepted.scheme === req.scheme &&
    accepted.network === req.network &&
    String(accepted.amount) === req.amount &&
    sameAddr(accepted.asset, req.asset) &&
    sameAddr(accepted.payTo, req.payTo)
  );
}

// --- facilitator ---------------------------------------------------------------------------------

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}
export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction?: string;
  network?: string;
  [k: string]: unknown;
}

class FacilitatorUnavailable extends Error {}

async function postFacilitator(
  x: X402Config,
  op: "verify" | "settle",
  payload: PaymentPayloadV2,
  requirements: PaymentRequirements,
): Promise<Record<string, unknown>> {
  const url = new URL(`${x.facilitatorUrl}/${op}`);
  const request: Record<string, unknown> = { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements };
  // OKX settles asynchronously by default; ask it to wait for the chain so the receipt carries the tx hash.
  if (x.facilitatorAuth && op === "settle") request.syncSettle = true;
  const json = JSON.stringify(request);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (x.facilitatorAuth) Object.assign(headers, okxHeaders(x.facilitatorAuth, "POST", url.pathname + url.search, json));
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: json,
      signal: AbortSignal.timeout(op === "verify" ? VERIFY_TIMEOUT_MS : SETTLE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new FacilitatorUnavailable(`facilitator ${op} unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FacilitatorUnavailable(`facilitator ${op} returned non-JSON (HTTP ${res.status})`);
  }
  if (!isObj(body)) throw new FacilitatorUnavailable(`facilitator ${op} returned an unexpected body (HTTP ${res.status})`);
  // OKX wraps results as { code, msg, data }. A non-zero code is an API-level failure (auth, rate limit),
  // not a verdict on the payment, so it counts as the facilitator being unavailable.
  if ("code" in body && !("isValid" in body) && !("success" in body)) {
    if (String(body.code) !== "0") {
      throw new FacilitatorUnavailable(`facilitator ${op} error ${String(body.code)}: ${String(body.msg ?? "")}`);
    }
    const data = Array.isArray(body.data) ? body.data[0] : body.data;
    if (!isObj(data)) throw new FacilitatorUnavailable(`facilitator ${op} returned no data`);
    return data;
  }
  return body;
}

export async function verifyPayment(x: X402Config, payload: PaymentPayloadV2, req: PaymentRequirements): Promise<VerifyResponse> {
  const body = await postFacilitator(x, "verify", payload, req);
  if (typeof body.isValid !== "boolean") throw new FacilitatorUnavailable("facilitator verify response has no isValid");
  return body as unknown as VerifyResponse;
}

export async function settlePayment(x: X402Config, payload: PaymentPayloadV2, req: PaymentRequirements): Promise<SettleResponse> {
  const body = await postFacilitator(x, "settle", payload, req);
  if (typeof body.success !== "boolean") throw new FacilitatorUnavailable("facilitator settle response has no success");
  return body as unknown as SettleResponse;
}

// --- request flow --------------------------------------------------------------------------------

// Bound facilitator calls per client: every request carrying a payment header costs a /verify round
// trip, so an unauthenticated caller must not be able to turn this server into a facilitator flooder.
const ATTEMPTS_PER_MINUTE = 60;
const attempts = new Map<string, number[]>();
function attemptLimited(ip: string, now: number): boolean {
  const hits = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= ATTEMPTS_PER_MINUTE) return true;
  hits.push(now);
  attempts.set(ip, hits);
  if (attempts.size > 5000) {
    for (const [k, ts] of attempts) if (!ts.some((t) => now - t < 60_000)) attempts.delete(k);
  }
  return false;
}

/** Response headers browsers need to see the payment headers on /v1 routes. */
export function paidCors(res: ServerResponse) {
  res.setHeader("access-control-allow-headers", "content-type, payment-signature, x-payment");
  res.setHeader("access-control-expose-headers", `${HEADER_PAYMENT_REQUIRED}, ${HEADER_PAYMENT_RESPONSE}`);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.end(JSON.stringify(body, null, 2));
}

function send402(res: ServerResponse, pr: PaymentRequired) {
  res.setHeader(HEADER_PAYMENT_REQUIRED, encodeHeader(pr));
  send(res, 402, pr);
}

/** What the paid handler produced. Anything with status >= 400 is returned as-is and never settled. */
export interface PaidResult {
  status: number;
  body: unknown;
}

/**
 * Gate one request behind an x402 payment:
 *   no header -> 402 challenge; bad/mismatched header -> 402; verify -> run the work -> settle -> 200.
 * `validate` runs before any facilitator call (input errors cost the caller nothing); `produce` runs
 * only after the payment verified. The paid body is released only once settlement succeeds.
 */
export async function handlePaid(
  req: IncomingMessage,
  res: ServerResponse,
  x: X402Config,
  route: PaidRoute,
  ip: string,
  produce: () => Promise<PaidResult>,
  validate?: () => Promise<PaidResult | null>,
): Promise<void> {
  const url = resourceUrl(req, x, route.path);
  const challenge = (error?: string) => send402(res, buildPaymentRequired(x, route, url, error));

  const raw = readPaymentHeader(req);
  if (!raw) return challenge("Payment required");

  if (attemptLimited(ip, Date.now())) {
    return send(res, 429, { error: "Too many payment attempts. Slow down." });
  }

  const decoded = decodePaymentHeader(raw);
  if (!decoded.ok) return challenge(decoded.reason);

  const requirements = requirementsFor(x);
  if (!matchesRequirements(decoded.payload.accepted, requirements)) {
    return challenge("payment_requirements_mismatch");
  }

  if (validate) {
    let early: PaidResult | null;
    try {
      early = await validate();
    } catch (e) {
      console.error(`[x402] validate failed: ${e instanceof Error ? e.message : String(e)}`);
      early = { status: 400, body: { error: "Bad request." } };
    }
    if (early) return send(res, early.status, early.body);
  }

  let verified: VerifyResponse;
  try {
    verified = await verifyPayment(x, decoded.payload, requirements);
  } catch (e) {
    console.error(`[x402] ${e instanceof Error ? e.message : String(e)}`);
    return send(res, 502, { error: "Payment facilitator unavailable. You were not charged." });
  }
  if (!verified.isValid) return challenge(verified.invalidReason || "payment_verification_failed");

  let result: PaidResult;
  try {
    result = await produce();
  } catch (e) {
    console.error(`[x402] paid handler failed: ${e instanceof Error ? e.message : String(e)}`);
    result = { status: 500, body: { error: "The paid call failed. You were not charged." } };
  }
  if (result.status >= 400) return send(res, result.status, result.body); // not settled: not charged

  let settled: SettleResponse;
  try {
    settled = await settlePayment(x, decoded.payload, requirements);
  } catch (e) {
    console.error(`[x402] ${e instanceof Error ? e.message : String(e)}`);
    return send(res, 502, { error: "Payment settlement could not be confirmed. Retry with a fresh payment." });
  }
  if (!settled.success) return challenge(settled.errorReason || "payment_settlement_failed");

  // The facilitator's settle response, verbatim. The OKX client reads status/transaction/amount/payer
  // from this header while a standard facilitator may send only success/transaction/network/payer, so
  // `status` and `amount` are filled in only when absent (for `exact` the settled amount is the quote).
  const receipt = {
    ...settled,
    ...(settled.status === undefined ? { status: "success" } : {}),
    ...(settled.amount === undefined ? { amount: requirements.amount } : {}),
  };
  res.setHeader(HEADER_PAYMENT_RESPONSE, encodeHeader(receipt));
  send(res, result.status, result.body);
}
