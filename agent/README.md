# Aumo agent

The reasoning brain and risk engine that allocates the vault within its on-chain guardrails.

Each cycle the agent runs five stages:

1. **Sense** — read the live vault (idle, deployed, caps, allowlist, positions) and join it with venue market data.
2. **Score** — the risk engine decomposes each venue into protocol, liquidity, peg, utilization, and concentration risk, blends them into one score and band, and haircuts APY into a risk-adjusted yield. It does not chase APY.
3. **Reason** — an optional LLM layer reads the regime and may only *tighten* the plan (go more defensive, veto a venue). It never loosens a limit or adds a venue; the result is re-enforced in code.
4. **Act** — moves are sent as `allocate` / `deallocate` calls, each inside the contract's hard caps. The vault re-checks every guardrail, so the worst a bug can do is revert.
5. **Record** — every tick appends an audit record: the inputs seen, the scores, the rationale, and the transaction hashes. The chain holds the receipts; this holds the reasoning.

## Run

```bash
npm install
cp .env.example .env   # fill in RPC_URL, VAULT_ADDRESS, AGENT_PRIVATE_KEY (testnet throwaway)
npm run plan           # dry-run: sense, score, reason — never sends a transaction
npm run tick           # one cycle; sends only if EXECUTE=1 and the key is the vault agent
npm run loop           # repeat every LOOP_INTERVAL_SECONDS
```

The LLM layer is optional. Without `ANTHROPIC_API_KEY` the agent runs on the deterministic risk engine alone and still produces a full plan and rationale.

## Safety

- The agent holds only the `agent` role. It cannot withdraw funds, change policy, or touch a non-allowlisted venue — those are owner-only on the contract.
- `EXECUTE=0` (default) is a dry-run. `EXECUTE=1` sends transactions, and the agent refuses to send unless its key matches `agent()` on the vault.
- Never put a mainnet key in `.env`. The testnet key is a throwaway.

## Paid endpoints (x402)

Other agents can pay per call, in USDT0 on X Layer, for Aumo's read of the market. The server speaks x402 v2, the protocol the OKX Agent Payments Protocol client (`onchainos payment quote` / `pay`) uses, with the `exact` scheme: the buyer signs an EIP-3009 `transferWithAuthorization`, so there is no approval step and no gas for the buyer.

The paid routes are off by default. With `X402_PAY_TO` or `X402_FACILITATOR_URL` unset they answer 404 and nothing else about the server changes. The free routes (`/health`, `/ask`, `/receipts`, `/receipts.csv`, `/attribution`, status) behave exactly as before.

### Routes

`GET /v1/signals` returns the agent's current view as JSON, taken from its latest recorded decision (the same receipt `/ask` is grounded in; nothing is fetched live):

- `takenAt`, `policyFingerprint`, `chainId`, `vault`, `assetSymbol`
- `regime`, `appetite`, `source`, `summary`
- `venues[]`: `name`, `address`, `kind`, `allowlisted`, `apyPct`, `riskAdjustedApyPct`, `riskBand`, `pegDeviationBps`, `pegVerified`, `exitLiquiditySharePct` (our principal in the venue as a percent of its withdrawable liquidity)
- `targetAllocation`: `idle` and per-venue `current` and `target` amounts in USDT0 plus `targetSharePct`, from applying the decision's moves to the recorded positions

`POST /v1/ask` takes `{"question": "...", "address": "0x..."}` (`address` is optional) and returns `{"answer": "..."}`. It is `/ask` but paid, so it is not subject to the free daily cap. An unpaid `GET /v1/ask` also returns the 402, and its `outputSchema` tells the client to replay as a POST with a `question`.

### How a call goes

1. Call without payment: HTTP 402. The `PAYMENT-REQUIRED` header is the base64 of the payment requirements, and the body is the same JSON in plain text.
2. The client signs and replays the request with a `PAYMENT-SIGNATURE` header. The legacy `X-PAYMENT` header name is accepted too, but the payload must be x402 v2.
3. The server checks the signed terms match its quote, verifies with the facilitator (`POST /verify`), does the work, then settles (`POST /settle`).
4. HTTP 200 with the result and a `PAYMENT-RESPONSE` header: the base64 of the facilitator's settle response (transaction hash, network, payer, amount, status).

Settlement only happens after the work succeeded, and the paid body is only sent once settlement succeeded. A bad input, an offline model, or a facilitator error means the caller is not charged. Browser clients can read both payment headers because CORS exposes them on the `/v1` routes.

### Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `X402_PAY_TO` | yes | Address that receives the payments. |
| `X402_FACILITATOR_URL` | yes | Base URL of an x402 facilitator that supports `exact` on `eip155:196` for USDT0. The server calls `<url>/verify` and `<url>/settle`. |
| `X402_PRICE` | no | Price per call in USDT0, default `0.01` (sent as `10000` base units, 6 decimals). |
| `X402_PUBLIC_URL` | no | Public base URL used for `resource.url` in the 402, for example `https://agent.example.com`. Without it the URL comes from the request's Host and X-Forwarded-Proto headers. |
| `X402_ASSET_EIP712_NAME`, `X402_ASSET_EIP712_VERSION` | no | EIP-712 domain of the asset. Defaults are `USD₮0` and `1`, checked on chain for X Layer USDT0 (its domain separator matches version `1`, not the `2` many clients assume). |

The asset is not configured separately. It is the base asset recorded in the venue config (the `underlying` of the lending venues), which on mainnet is USDT0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`. The testnet venue set has no base asset, so the paid routes stay off there. The network is `eip155:<CHAIN_ID>`.

There is no default facilitator. Point `X402_FACILITATOR_URL` at one you have confirmed settles USDT0 on X Layer mainnet before turning this on.

### Example

```bash
curl -i https://<agent-host>/v1/signals
```

```text
HTTP/1.1 402 Payment Required
content-type: application/json
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi...
access-control-expose-headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE

{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "https://<agent-host>/v1/signals",
    "description": "Aumo treasury signals for the USDT0 pool on X Layer: regime, risk appetite, per-venue APY and risk-adjusted APY, risk band, allowlist status, peg deviation, exit-liquidity share, and the target allocation from the agent's latest decision.",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:196",
      "amount": "10000",
      "asset": "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
      "payTo": "<X402_PAY_TO>",
      "maxTimeoutSeconds": 120,
      "extra": { "name": "USD₮0", "version": "1" },
      "outputSchema": { "input": { "type": "http", "method": "GET" } }
    }
  ]
}
```

With the OKX client: `onchainos payment quote https://<agent-host>/v1/signals`, confirm, then `onchainos payment pay --payment-id <id> --yes`.
