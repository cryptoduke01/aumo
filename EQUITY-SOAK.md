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

## Before mainnet (out of soak scope — mainnet phase)

- Real `ChainlinkEquityOracle` wrapper; confirm X Layer's Chainlink product (Data Streams pull-verify
  vs Data Feeds AggregatorV3) + feed ids + xStock addresses. Fork-test vs live X Layer.
- Decide DEX routing (direct xStock/USD₮0 vs via USDG) + fee tier.
- Address Kensho M2 (feed-retirement exit freeze → `setMarketClock`) and M3 (adapter-oracle
  migration path). Full external Kensho fleet. Web opt-in "at-risk" surface + terms/disclaimers.
