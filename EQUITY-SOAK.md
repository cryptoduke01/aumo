# Tokenized equity — 3-day testnet soak runbook

The opt-in, at-risk equity feature runs as a **separate** `EquityPool` (never allowlisted on the safe
pool). This is the runbook to stand it up on X Layer testnet and soak it for 3 days before the mainnet
phase. Everything below is testnet (chain 1952) with mocks we control; the two immutables confirmed
during the soak before mainnet are the real Chainlink product/addresses and the live xStock/USD₮0 pool.

## What's deployed

- `EquityPool` — ERC-4626, opt-in, directional. Market-hours gate on deposit/mint/withdraw/redeem
  (entry AND exit freeze while the equity feed is stale = market closed). No churn-loss metering on
  agent retreats (a drawdown is a market move); churn bounded by caps + the deploy budget.
- `EquityAdapter` — buys/holds/sells the xStock via a v3 router, oracle-guarded (refuse on stale/zero
  price + oracle-derived `amountOutMinimum`). `withdraw(amount)` realizes ≥ amount.
- Mocks (testnet only): a settable equity oracle (the market clock), a test xStock, a swap router.

## 1. Deploy (you run this — needs the VAULT_OWNER key)

From `contracts/`, broadcasting as `VAULT_OWNER` (the same test owner key used for the other testnet
pools; the pool sets `agent = owner`):

```bash
cd contracts && FOUNDRY_DISABLE_NIGHTLY_WARNING=1 forge script script/DeployEquityPoolTestnet.s.sol \
  --rpc-url "$XLAYER_TESTNET_RPC" --account <your-keystore> --broadcast --allow-project-env
```

Copy the five addresses it prints: `EquityPool`, `EquityAdapter`, `stock`, `oracle`, `swap router`.

## 2. Point the agent at it

Fill `agent/config/equity.testnet.json` with `pool` (EquityPool), `venue` (EquityAdapter), `oracle`,
`router`. Or pass them as env (`EQUITY_POOL` / `EQUITY_VENUE` / `EQUITY_ORACLE` / `EQUITY_ROUTER`).
Use the **owner/agent** key as `AGENT_PRIVATE_KEY` (the pool's `agent` is the owner unless you
`setAgent` to a dedicated key first).

## 3. Run the soak (two long-running processes)

```bash
cd agent && EXECUTE=1 npm run equity-loop
```
The executor: each cycle, if the market is open and the pool holds idle USD₮0, it deploys idle into
the single xStock venue within the pool's caps. It never scores yield, never picks a stock, never
force-sells — a deposit *is* the chosen exposure; exits are depositor redemptions.

```bash
cd agent && EXECUTE=1 npm run equity-feed
```
The feeder (testnet only): during ~US market hours (14:30–21:00 UTC, Mon–Fri) it random-walks the
price and republishes it fresh so NAV moves and the gate reads OPEN; outside those hours it publishes
nothing, so the clock ages past the pool's 1h `maxAge` and the gate reads CLOSED — exercising the
weekend/overnight freeze.

Dry-run either without `EXECUTE=1` (`npm run equity-plan` for a single read-only cycle).

## 4. Drive deposits + watch (during the soak)

- Deposit test USD₮0 into `EquityPool` (the deploy seeds the owner with 50k test USD₮0). Watch the
  executor deploy it into the stock next open cycle; watch NAV move with the feeder's price.
- Try to redeem while the feeder shows CLOSED → the pool must revert `MarketClosed` (the M1 gate).
- Redeem while OPEN → the adapter sells back and the pool pays out.
- Equity cycle receipts land in `agent/receipts/equity.jsonl`.

## What to confirm over the 3 days

- Entry and exit both freeze cleanly across every overnight and the weekend; both resume on reopen.
- NAV tracks the stock up and down; a full redeem never bricks (no wei-short revert).
- The executor only ever deploys within caps and never trades while closed; no stuck approvals.
- No unexpected reverts in the executor/feeder logs.

## The real oracle (BUILT — `ChainlinkStreamsEquityOracle`)

Confirmed by research (Sep 2026): X Layer runs Chainlink **Data Streams** for equities (OKX, Jun 17
2026: 24/5 US equities incl. NVDA/TSLA/AAPL, plus tokenized treasuries + commodities). It is
**pull-based** — an off-chain report is fetched and its DON signatures are checked on-chain by a
`VerifierProxy`. US equities use the **RWA Advanced (v11)** schema, which carries an explicit
`marketStatus` (0 Unknown, 1 Pre-market, 2 Regular, 3 Post-market, 4 Overnight, 5 Closed) and
bid/ask/mid. **Subscription billing** means `verify` takes an empty `parameterPayload` and needs no
LINK approval or per-call fee.

`contracts/src/oracles/ChainlinkStreamsEquityOracle.sol` implements this behind the existing
`IEquityOracle`: a trusted `updater` (the agent, or a Chainlink Automation upkeep) submits a fresh
verified report each cycle via `updateReport(payload)`; the contract decodes v11, scales `mid` to
WAD, and stores it with the market status. `priceWad(feedId)` returns the last price, with
`updatedAt = 0` whenever the market is not in a tradeable state (Regular always; Pre/Post only if the
owner enables `allowExtendedHours`; never Overnight/Closed/Unknown) — so the **existing** adapter
freshness guard and pool `marketOpen()` refuse to trade/enter/exit while closed, with NO change to
either, and NAV keeps reading the last price. Staleness is a second, independent guard if the updater
stalls. 11 unit tests (decode → scale → market-status fold → staleness) pass against a mock verifier.

The agent is the natural updater: it already runs a loop, so it fetches the Data Streams report
off-chain (with the project's Streams credentials) and calls `updateReport` before trading each cycle.
This feeder is BUILT: `agent/src/equity/streamsClient.ts` (HMAC-SHA256-signed Data Streams REST client
— signing unit-tested in `test/streams-auth.test.ts`) + `agent/src/equity/oracleUpdater.ts` (fetch the
latest report per feed and submit `updateReport`, refusing unless our key is the oracle's `updater`).
Run it on mainnet with `npm run equity-oracle-update`, given env `STREAMS_API_URL` / `STREAMS_API_KEY`
/ `STREAMS_API_SECRET` (the OKX/Chainlink onboarding), `EQUITY_STREAMS_ORACLE` (the oracle address),
and `STREAMS_FEED_IDS` (the Data Streams feed IDs). Only the live network round trip is unverified;
confirm it end to end on a fork before mainnet.

**Still to lock at mainnet (immutables / live values, confirm on a fork):**
- Live X Layer `VerifierProxy` address; per-asset **stream (feed) IDs** for NVDA/TSLA/AAPL (there are
  phase-specific streams: RegularHours / ExtendedHours / OvernightHours — v1 uses RegularHours).
- Each feed's `mid` **decimals** (8 or 18) for `registerFeed`.
- Re-confirm the exact **v11 field order/types** against Chainlink's canonical StreamsLib (the struct
  in the contract is transcribed from the docs; the unit suite proves the LOGIC, not the wire format).
- The **xStock EVM token addresses** on X Layer (the search-returned `2uV5…A3gK` is the SOLANA token;
  X Layer needs the `0x…` addresses) and the routing. On-chain xStock liquidity on X Layer sits against
  **USDG** (the RWA-incentive pools are USDG-NVDAx / USDG-AAPLx / USDC-TSLAx), and there is no direct
  xStock/USD₮0 pool. So the mainnet route is one of: (a) a **USDG-based equity pool** trading USDG ->
  xStock in one hop (deepest liquidity, least slippage; reuse Aumo's USDG on-ramp), or (b) a **USD₮0
  pool** routing USD₮0 -> USDG -> xStock. The adapter is now **v3 path-agnostic** (`exactInput` with an
  encoded buy/sell path), so either is a deploy-time choice with no code change — pull the xStock token
  + pool addresses and fee tiers from the explorer and encode the path. On a multi-hop route, size
  `slippageBps` to cover both hops.

## Other before-mainnet items

- Fork-test the equity stack (pool + adapter + real oracle) vs live X Layer.
- Address Kensho M2 (feed-retirement exit freeze → `setMarketClock`) and M3 (adapter-oracle
  migration path). Full external Kensho fleet. Web opt-in "at-risk" surface + terms/disclaimers.
