# Try Aumo on testnet

This is the whole product, running on X Layer testnet with play money. You deposit a stablecoin, an
AI agent puts it to work across venues inside on-chain guardrails, and you can withdraw any time.
Nothing here uses real funds.

---

## Part A — Test it as a user (about 5 minutes, no command line)

**1. Use a fresh wallet.** Create a new wallet in MetaMask or OKX Wallet just for this. Don't use one
that holds real money.

**2. Add the network.** X Layer Testnet — chain ID `1952`, RPC `https://testrpc.xlayer.tech`, symbol
OKB, explorer `https://www.oklink.com/xlayer-test`. (Once you connect in the app, the wallet menu can
add it for you.)

**3. Get a little gas.** You need a small amount of testnet OKB to pay for transactions. Get it from
the X Layer testnet faucet (search "X Layer testnet faucet" on the OKX / X Layer docs) and send it to
your wallet.

**4. Open the app and connect.** Go to the app, open the wallet menu, and connect. Approve the
network switch if asked.

**5. Get test USDT0.** On the **Deposit** tab, under Wallet balance, click **"Get 1,000 test USDT0"**.
That mints play-money USDT0 straight to your wallet. (This button only exists on testnet.)

**6. Deposit.** Enter an amount and deposit. The first deposit asks for a one-time approval (lets the
pool move your USDT0), then the deposit itself. You receive pool shares — your claim on the pool.

**7. Watch the agent work.** On **Overview** you'll see total value, how much is idle vs deployed, the
risk-adjusted-yield chart, and the agent's latest reasoning in plain language. **Venues** shows how it
scored each option; **Activity** is the running trail of every decision.

**8. Withdraw.** Redeem your shares back to USDT0 any time. Withdrawals never wait on the agent — you
can always take out whatever is currently recoverable.

That's the full experience. What's real: the contract, the guardrails, the ERC-4626 accounting, the
agent's reasoning, your deposit and withdrawal. What's a stand-in: on testnet there's no real DeFi, so
the two venues are mocks with illustrative numbers. On mainnet the same code points at real Aave and a
Treasury-backed dollar.

---

## Part B — Operator notes (you do NOT need this to test as a user)

These are the one-time setup steps the Aumo team runs. A user never touches them.

**Live testnet addresses**

| | |
|---|---|
| Pool (AumoPool, fixed source) | `0x9A972bEeA00C6f2D76781586eAbd0c16e9b6d360` |
| Test USDT0 (mock, public mint) | `0xFc440733d882f28012B190b11Bbec56b44508448` |
| MockYield / StableVault | `0x923A9faAd9902CD7016D5E24615dc7af21AC9ad2` / `0xC1a0EB3Ee25153674D11eFD483E0367e72CdFAa8` |

**Run the agent** (from `agent/`, `.env` filled):

```bash
npm run plan    # dry-run: sense → score → reason → plan. Sends nothing.
npm run tick    # one live cycle. Sends only if EXECUTE=1 and the key == on-chain agent().
npm run loop    # repeat every LOOP_INTERVAL_SECONDS
```

**Redeploy the pool from source** (only when the contract changes):

```bash
cd contracts
VAULT_OWNER=<owner> forge script script/DeployPoolV2Testnet.s.sol \
  --rpc-url https://testrpc.xlayer.tech --private-key <key> --broadcast
```

Then repoint `web/lib/chain.ts` (`ADDR.testnet.pool`) and `agent/.env` (`VAULT_ADDRESS`) at the new
address, and update `agent/config/venues.testnet.json` with the new mock venue addresses.

**Hosted agent (Railway):** set `VAULT_ADDRESS` to the pool, mount a persistent volume and set
`RECEIPTS_DIR` to it (so the receipt trail survives restarts), and redeploy.

**Safety:** testnet only, throwaway keys. `EXECUTE=0` is the default and sends nothing. Never put a
mainnet key in `agent/.env`.
