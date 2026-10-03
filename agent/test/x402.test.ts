import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Config, VenueFeedFile } from "../src/config.js";

// The receipts path is resolved when the server module loads, so point it at a fixture first.
const RECEIPTS_DIR = mkdtempSync(join(tmpdir(), "aumo-x402-"));
process.env.RECEIPTS_DIR = RECEIPTS_DIR;
process.env.PORT = "0";
const { startServer, buildSignals } = await import("../src/server.js");
const { loadX402, toBaseUnits, baseAssetFrom } = await import("../src/x402.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const feed = (name: string) =>
  JSON.parse(readFileSync(join(HERE, "..", "config", `venues.${name}.json`), "utf8")) as VenueFeedFile;
const MAINNET = feed("mainnet");
const TESTNET = feed("testnet");

const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736"; // what config/venues.mainnet.json records
const PAY_TO = "0x1111111111111111111111111111111111111111"; // test address, no key behind it
const PAYER = "0x2222222222222222222222222222222222222222";

// --- receipt fixture: a synthetic decision in the same shape act/receipts.ts writes -------------
const VA = "0x00000000000000000000000000000000000000a1";
const VB = "0x00000000000000000000000000000000000000b2";
const VC = "0x00000000000000000000000000000000000000c3";
const DECISION = {
  takenAt: "2026-10-03T12:00:00.000Z",
  policyFingerprint: "0xfeedface",
  vault: "0x00000000000000000000000000000000000000aa",
  snapshot: {
    vault: { address: "0x00000000000000000000000000000000000000aa", decimals: 6, symbol: "USD₮0", idle: "20000000", totalDeployed: "80000000" },
    venues: [
      { address: VA, name: "Lend A", kind: "lending", allowed: true, liquidityUsd: 500000, pegDeviationBps: 0, pegVerified: true, allocatedPrincipal: "60000000", liveBalance: "60100000" },
      { address: VB, name: "RWA B", kind: "rwa", allowed: true, liquidityUsd: 200000, pegDeviationBps: 4, pegVerified: true, allocatedPrincipal: "20000000", liveBalance: "20000000" },
      { address: VC, name: "RWA C", kind: "rwa", allowed: false, liquidityUsd: 0, pegDeviationBps: 9, pegVerified: false, allocatedPrincipal: "0", liveBalance: "0" },
    ],
  },
  plan: {
    regime: "calm",
    appetite: "moderate",
    source: "risk-engine+panel",
    summary: "Add 10 to RWA B.",
    idleAfter: "10000000",
    moves: [{ venue: VB, venueName: "RWA B", action: "allocate", amount: "10000000" }],
    risks: [
      { address: VA, name: "Lend A", apyBps: 459, riskAdjustedApyBps: 343, band: "moderate" },
      { address: VB, name: "RWA B", apyBps: 410, riskAdjustedApyBps: 330, band: "low" },
      { address: VC, name: "RWA C", apyBps: 600, riskAdjustedApyBps: 200, band: "elevated" },
    ],
  },
  execution: null,
};
writeFileSync(join(RECEIPTS_DIR, "decisions.jsonl"), JSON.stringify(DECISION) + "\n");

// --- network guard + model stub: no test ever leaves localhost ----------------------------------
const realFetch = globalThis.fetch;
let groq: () => Response = () => new Response("not stubbed", { status: 500 });
let groqCalls = 0;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.groq.com/")) {
    groqCalls++;
    return groq();
  }
  if (!url.startsWith("http://127.0.0.1:")) throw new Error(`test blocked an external fetch: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

// --- mock facilitator (standard x402 POST /verify and POST /settle) -----------------------------
type FacCall = { op: string; body: { x402Version: number; paymentPayload: Record<string, unknown>; paymentRequirements: Record<string, unknown> } };
const fac = {
  verify: { isValid: true, payer: PAYER } as Record<string, unknown>,
  settle: { success: true, transaction: "0xabc123", network: "eip155:196", payer: PAYER } as Record<string, unknown>,
  calls: [] as FacCall[],
};
const facilitator: Server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const op = (req.url ?? "").replace(/^\//, "");
  fac.calls.push({ op, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(op === "verify" ? fac.verify : fac.settle));
});
facilitator.listen(0, "127.0.0.1");
await once(facilitator, "listening");
const FAC_URL = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
after(() => facilitator.close());

function resetFac() {
  fac.verify = { isValid: true, payer: PAYER };
  fac.settle = { success: true, transaction: "0xabc123", network: "eip155:196", payer: PAYER };
  fac.calls = [];
}

function cfgFor(venues: VenueFeedFile, over: Partial<Config> = {}): Config {
  return {
    chainId: venues.chainId,
    chainName: "X Layer",
    rpcUrl: "http://127.0.0.1:1",
    vaultAddress: "0x00000000000000000000000000000000000000aa",
    model: "test-model",
    appetite: "moderate",
    maxConcentration: 0.6,
    loopIntervalMs: 900_000,
    execute: false,
    venues: venues.venues,
    ...over,
  };
}

const X402_KEYS = ["X402_PAY_TO", "X402_FACILITATOR_URL", "X402_PRICE", "X402_PUBLIC_URL"];

/** Start the real server with the given x402 env; returns its base URL and a closer. */
async function serve(env: Record<string, string>, cfg: Config = cfgFor(MAINNET)) {
  for (const k of X402_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const server = startServer(cfg);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const PAID_ENV = { X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: FAC_URL, X402_PUBLIC_URL: "https://agent.example" };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const unb64 = (s: string | null) => JSON.parse(Buffer.from(s ?? "", "base64").toString("utf8"));

/** What a client signs: the quoted accepts[0] echoed back, plus an EIP-3009 authorization. */
function paymentFor(accepted: Record<string, unknown>) {
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: { from: PAYER, to: PAY_TO, value: String(accepted.amount), validAfter: "0", validBefore: "9999999999", nonce: `0x${"22".repeat(32)}` },
    },
  };
}

async function quote(base: string, path: string) {
  const r = await fetch(`${base}${path}`);
  assert.equal(r.status, 402);
  return unb64(r.headers.get("payment-required")).accepts[0] as Record<string, unknown>;
}

// --- config ---------------------------------------------------------------------------------------

test("x402 config: price converts to 6-decimal base units, malformed prices are refused", () => {
  assert.equal(toBaseUnits("0.01", 6), "10000");
  assert.equal(toBaseUnits("1", 6), "1000000");
  assert.equal(toBaseUnits("0.000001", 6), "1");
  assert.equal(toBaseUnits("0.0000001", 6), null);
  assert.equal(toBaseUnits("0", 6), null);
  assert.equal(toBaseUnits("-1", 6), null);
  assert.equal(toBaseUnits("1e3", 6), null);
});

test("x402 config: asset is the USDT0 address from the venue config; disabled unless fully configured", () => {
  assert.equal(baseAssetFrom(MAINNET.venues), USDT0);
  assert.equal(baseAssetFrom(TESTNET.venues), undefined); // mock venues carry no base asset

  const on = loadX402(cfgFor(MAINNET), { X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: `${FAC_URL}/` });
  assert.ok(on.enabled);
  assert.equal(on.config.asset, USDT0);
  assert.equal(on.config.network, "eip155:196");
  assert.equal(on.config.amount, "10000"); // default 0.01 USDT0
  assert.equal(on.config.facilitatorUrl, FAC_URL); // trailing slash trimmed

  assert.equal(loadX402(cfgFor(MAINNET), {}).enabled, false);
  assert.equal(loadX402(cfgFor(MAINNET), { X402_PAY_TO: PAY_TO }).enabled, false);
  assert.equal(loadX402(cfgFor(MAINNET), { X402_FACILITATOR_URL: FAC_URL }).enabled, false);
  assert.equal(loadX402(cfgFor(MAINNET), { X402_PAY_TO: "0xnope", X402_FACILITATOR_URL: FAC_URL }).enabled, false);
  assert.equal(loadX402(cfgFor(MAINNET), { ...PAID_ENV, X402_PRICE: "0.0000001" }).enabled, false);
  assert.equal(loadX402(cfgFor(TESTNET), PAID_ENV).enabled, false);
  const priced = loadX402(cfgFor(MAINNET), { ...PAID_ENV, X402_PRICE: "0.25" });
  assert.ok(priced.enabled);
  assert.equal(priced.config.amount, "250000");
});

// --- routes ---------------------------------------------------------------------------------------

test("paid routes answer 404 with a clear message when X402 env is unset; free routes unchanged", async () => {
  resetFac();
  const { base, close } = await serve({});
  try {
    for (const [path, method] of [["/v1/signals", "GET"], ["/v1/ask", "POST"]] as const) {
      const r = await fetch(`${base}${path}`, { method });
      assert.equal(r.status, 404);
      const body = await r.json();
      assert.match(body.error, /not enabled/);
      assert.match(body.reason, /X402_PAY_TO and X402_FACILITATOR_URL/);
      assert.equal(r.headers.get("payment-required"), null);
    }
    const h = await fetch(`${base}/health`);
    assert.equal(await h.text(), JSON.stringify({ ok: true }));
    // Free-route CORS is untouched: no payment headers allowed or exposed on /ask.
    const pre = await fetch(`${base}/ask`, { method: "OPTIONS" });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-headers"), "content-type");
    assert.equal(pre.headers.get("access-control-expose-headers"), null);
    assert.equal(fac.calls.length, 0);
  } finally {
    await close();
  }
});

test("unpaid GET /v1/signals returns a v2 402: PAYMENT-REQUIRED header equals the body", async () => {
  resetFac();
  const { base, close } = await serve(PAID_ENV);
  try {
    const r = await fetch(`${base}/v1/signals`);
    assert.equal(r.status, 402);
    const fromHeader = unb64(r.headers.get("payment-required"));
    const body = await r.json();
    assert.deepEqual(fromHeader, body);
    assert.equal(body.x402Version, 2);
    assert.equal(body.error, "Payment required");
    assert.deepEqual(body.resource, {
      url: "https://agent.example/v1/signals",
      description: body.resource.description,
      mimeType: "application/json",
    });
    assert.match(body.resource.description, /regime/);
    assert.equal(body.accepts.length, 1);
    assert.deepEqual(body.accepts[0], {
      scheme: "exact",
      network: "eip155:196",
      amount: "10000",
      asset: USDT0,
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
      extra: { name: "USD₮0", version: "1" },
      outputSchema: { input: { type: "http", method: "GET" } },
    });
    assert.match(r.headers.get("access-control-expose-headers") ?? "", /PAYMENT-RESPONSE/);
    assert.match(r.headers.get("access-control-expose-headers") ?? "", /PAYMENT-REQUIRED/);
    const pre = await fetch(`${base}/v1/signals`, { method: "OPTIONS" });
    assert.match(pre.headers.get("access-control-allow-headers") ?? "", /payment-signature/);
    assert.equal(fac.calls.length, 0, "no facilitator call without a payment");
  } finally {
    await close();
  }
});

test("valid payment: verify ok + settle ok returns 200, PAYMENT-RESPONSE, and the signals", async () => {
  resetFac();
  const { base, close } = await serve(PAID_ENV);
  try {
    const accepted = await quote(base, "/v1/signals");
    const r = await fetch(`${base}/v1/signals`, { headers: { "PAYMENT-SIGNATURE": b64(paymentFor(accepted)) } });
    assert.equal(r.status, 200);
    const receipt = unb64(r.headers.get("payment-response"));
    assert.equal(receipt.success, true);
    assert.equal(receipt.transaction, "0xabc123");
    assert.equal(receipt.network, "eip155:196");
    assert.equal(receipt.payer, PAYER);
    assert.equal(receipt.status, "success");
    assert.equal(receipt.amount, "10000");

    // The facilitator saw verify then settle, each against OUR terms (not the client's echo).
    assert.deepEqual(fac.calls.map((c) => c.op), ["verify", "settle"]);
    for (const c of fac.calls) {
      assert.equal(c.body.x402Version, 2);
      assert.deepEqual(c.body.paymentRequirements, {
        scheme: "exact",
        network: "eip155:196",
        amount: "10000",
        asset: USDT0,
        payTo: PAY_TO,
        maxTimeoutSeconds: 120,
        extra: { name: "USD₮0", version: "1" },
      });
      assert.deepEqual(c.body.paymentPayload, paymentFor(accepted));
    }

    const s = await r.json();
    assert.deepEqual(s, buildSignals(DECISION, 196));
    assert.equal(s.takenAt, DECISION.takenAt);
    assert.equal(s.policyFingerprint, "0xfeedface");
    assert.equal(s.regime, "calm");
    assert.equal(s.appetite, "moderate");
    const a = s.venues.find((v: { name: string }) => v.name === "Lend A");
    assert.deepEqual(a, {
      name: "Lend A",
      address: VA,
      kind: "lending",
      allowlisted: true,
      apyPct: 4.59,
      riskAdjustedApyPct: 3.43,
      riskBand: "moderate",
      pegDeviationBps: 0,
      pegVerified: true,
      exitLiquiditySharePct: 0.012, // 60 of 500,000 withdrawable
    });
    const c = s.venues.find((v: { name: string }) => v.name === "RWA C");
    assert.equal(c.allowlisted, false);
    assert.equal(c.exitLiquiditySharePct, null); // no liquidity figure, no ratio
    // Target allocation: +10 into B out of idle.
    assert.deepEqual(s.targetAllocation, {
      idle: { current: 20, target: 10, targetSharePct: 10 },
      venues: [
        { name: "Lend A", address: VA, current: 60, target: 60, targetSharePct: 60 },
        { name: "RWA B", address: VB, current: 20, target: 30, targetSharePct: 30 },
        { name: "RWA C", address: VC, current: 0, target: 0, targetSharePct: 0 },
      ],
    });
  } finally {
    await close();
  }
});

test("the legacy X-PAYMENT header name is accepted as a carrier for a v2 payload", async () => {
  resetFac();
  const { base, close } = await serve(PAID_ENV);
  try {
    const accepted = await quote(base, "/v1/signals");
    const r = await fetch(`${base}/v1/signals`, { headers: { "X-PAYMENT": b64(paymentFor(accepted)) } });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("payment-response"));
  } finally {
    await close();
  }
});

test("verify failure returns 402 with the facilitator's reason and settles nothing", async () => {
  resetFac();
  fac.verify = { isValid: false, invalidReason: "invalid_exact_evm_payload_signature", payer: PAYER };
  const { base, close } = await serve(PAID_ENV);
  try {
    const accepted = await quote(base, "/v1/signals");
    const r = await fetch(`${base}/v1/signals`, { headers: { "PAYMENT-SIGNATURE": b64(paymentFor(accepted)) } });
    assert.equal(r.status, 402);
    const body = await r.json();
    assert.equal(body.error, "invalid_exact_evm_payload_signature");
    assert.deepEqual(unb64(r.headers.get("payment-required")), body);
    assert.equal(r.headers.get("payment-response"), null);
    assert.equal(body.venues, undefined, "no signals without payment");
    assert.deepEqual(fac.calls.map((c) => c.op), ["verify"]);
  } finally {
    await close();
  }
});

test("malformed payment headers return 402 without calling the facilitator", async () => {
  resetFac();
  const { base, close } = await serve(PAID_ENV);
  try {
    const cases: Array<[string, string]> = [
      ["not base64 at all!!", "invalid_payment_header"],
      [Buffer.from("this is not json").toString("base64"), "invalid_payment_header"],
      [b64(["an", "array"]), "invalid_payment_header"],
      [b64({ x402Version: 1, scheme: "exact", network: "x-layer", payload: {} }), "unsupported_x402_version"],
      [b64({ x402Version: 2, accepted: "nope", payload: {} }), "invalid_payment_payload"],
    ];
    for (const [header, reason] of cases) {
      const r = await fetch(`${base}/v1/signals`, { headers: { "PAYMENT-SIGNATURE": header } });
      assert.equal(r.status, 402, header);
      assert.equal((await r.json()).error, reason, header);
      assert.ok(r.headers.get("payment-required"));
    }
    assert.equal(fac.calls.length, 0);
  } finally {
    await close();
  }
});

test("a payment signed for different terms is refused locally with 402", async () => {
  resetFac();
  const { base, close } = await serve(PAID_ENV);
  try {
    const accepted = await quote(base, "/v1/signals");
    for (const over of [{ amount: "1" }, { payTo: PAYER }, { asset: PAYER }, { network: "eip155:1" }]) {
      const r = await fetch(`${base}/v1/signals`, { headers: { "PAYMENT-SIGNATURE": b64(paymentFor({ ...accepted, ...over })) } });
      assert.equal(r.status, 402);
      assert.equal((await r.json()).error, "payment_requirements_mismatch");
    }
    // Address casing is not a mismatch.
    const lower = { ...accepted, asset: String(accepted.asset).toLowerCase(), payTo: String(accepted.payTo).toLowerCase() };
    const ok = await fetch(`${base}/v1/signals`, { headers: { "PAYMENT-SIGNATURE": b64(paymentFor(lower)) } });
    assert.equal(ok.status, 200);
  } finally {
    await close();
  }
});

test("settlement failure returns 402 and never releases the paid body", async () => {
  resetFac();
  fac.settle = { success: false, errorReason: "invalid_transaction_state", transaction: "", network: "eip155:196" };
  const { base, close } = await serve(PAID_ENV);
  try {
    const accepted = await quote(base, "/v1/signals");
    const r = await fetch(`${base}/v1/signals`, { headers: { "PAYMENT-SIGNATURE": b64(paymentFor(accepted)) } });
    assert.equal(r.status, 402);
    const body = await r.json();
    assert.equal(body.error, "invalid_transaction_state");
    assert.equal(body.venues, undefined);
    assert.equal(r.headers.get("payment-response"), null);
    assert.deepEqual(fac.calls.map((c) => c.op), ["verify", "settle"]);
  } finally {
    await close();
  }
});

test("an unreachable facilitator is a 502 and nobody is charged", async () => {
  resetFac();
  const { base, close } = await serve({ ...PAID_ENV, X402_FACILITATOR_URL: "http://127.0.0.1:1" });
  try {
    const accepted = await quote(base, "/v1/signals");
    const r = await fetch(`${base}/v1/signals`, { headers: { "PAYMENT-SIGNATURE": b64(paymentFor(accepted)) } });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /not charged/);
  } finally {
    await close();
  }
});

test("/v1/ask: 402 advertises the POST body, input errors cost nothing, a real answer settles, a model failure does not", async () => {
  resetFac();
  const { base, close } = await serve(PAID_ENV, cfgFor(MAINNET, { groqKey: "test-key-not-real" }));
  try {
    // A GET probe gets the same terms plus how to call it.
    const accepted = await quote(base, "/v1/ask");
    assert.equal(accepted.amount, "10000");
    const schema = accepted.outputSchema as { input: { method: string; body: { required: string[] } } };
    assert.equal(schema.input.method, "POST");
    assert.deepEqual(schema.input.body.required, ["question"]);
    const unpaidPost = await fetch(`${base}/v1/ask`, { method: "POST", body: JSON.stringify({ question: "hi" }) });
    assert.equal(unpaidPost.status, 402);

    const pay = { "PAYMENT-SIGNATURE": b64(paymentFor(accepted)), "content-type": "application/json" };

    // Empty question: 400 before any facilitator call.
    const empty = await fetch(`${base}/v1/ask`, { method: "POST", headers: pay, body: JSON.stringify({ question: "  " }) });
    assert.equal(empty.status, 400);
    assert.equal(fac.calls.length, 0);

    // Model answers: verify, answer, settle, 200.
    groqCalls = 0;
    groq = () => Response.json({ choices: [{ message: { content: "Most of the pool sits in Lend A." } }] });
    const ok = await fetch(`${base}/v1/ask`, { method: "POST", headers: pay, body: JSON.stringify({ question: "Where is most of the pool?" }) });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { answer: "Most of the pool sits in Lend A." });
    assert.equal(unb64(ok.headers.get("payment-response")).transaction, "0xabc123");
    assert.deepEqual(fac.calls.map((c) => c.op), ["verify", "settle"]);
    assert.equal(groqCalls, 1);

    // Model down: verified but never settled, so the caller is not charged.
    resetFac();
    groq = () => new Response("upstream down", { status: 503 });
    const down = await fetch(`${base}/v1/ask`, { method: "POST", headers: pay, body: JSON.stringify({ question: "Is the peg holding?" }) });
    assert.equal(down.status, 502);
    assert.equal((await down.json()).charged, false);
    assert.equal(down.headers.get("payment-response"), null);
    assert.deepEqual(fac.calls.map((c) => c.op), ["verify"]);
  } finally {
    await close();
  }
});

test("/v1/ask answers 503, not 402, when the reasoning layer is offline", async () => {
  resetFac();
  const { base, close } = await serve(PAID_ENV); // no model key
  try {
    const r = await fetch(`${base}/v1/ask`, { method: "POST", body: JSON.stringify({ question: "hi" }) });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("payment-required"), null);
    assert.equal(fac.calls.length, 0);
  } finally {
    await close();
  }
});
