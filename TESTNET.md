# Testing Aumo on X Layer testnet

A hands-on runbook for exercising the whole product on testnet: fund a wallet, deposit,
watch the agent sense/score/reason/act, and withdraw. No real money, throwaway keys only.

## What you are actually testing

On X Layer **testnet there is no real DeFi**, so the two venues (`MockYield`, `StableVault`) are
mock adapters with illustrative metrics — enough for the risk engine to genuinely choose between
them. The contract, the ERC-4626 accounting, the guardrails, the agent's five-stage cycle, the
dashboard, deposits and withdrawals are all the real code. On mainnet the same code points at the
real Aave / USDG adapters. So: **the machinery is real, the yield sources are stand-ins.**

> Before a meaningful run, redeploy the testnet pool from current source (see §6). The pool the app
> currently points at (`0x057C…d626`) is **pre-fix bytecode** and is missing the loss/deploy budgets,
> impairment, and redemption isolation. Testing UX against it is fine; testing agent *behaviour*
> should be against a fresh redeploy.

## Coordinates

| | |
|---|---|
| Network | X Layer Testnet |
| Chain ID | `1952` |
| RPC | `https://testrpc.xlayer.tech` |
| Native gas token | OKB |
| Explorer | https://www.oklink.com/xlayer-test |
| Test USDT0 (mock, public mint) | `0xFc440733d882f28012B190b11Bbec56b44508448` |
| Pool (current, pre-fix) | `0x057Caa4fC699bF830b8AE2E3B1f5D0D75eABd626` |

## 1. Add the network + a throwaway wallet

Use a **fresh** wallet you create just for this (MetaMask or OKX Wallet). Never use a wallet that
holds real funds. Add X Layer Testnet with the coordinates above (or let the app's "add network"
button in Settings do it after you connect).

## 2. Get gas (OKB)

You need a little testnet OKB for gas. Use the official X Layer testnet faucet (OKX X Layer faucet —
search "X Layer testnet faucet" from the OKX/X Layer docs) and send OKB to your wallet address. A
fraction of an OKB is plenty for many transactions.

## 3. Get test USDT0

The test USDT0 is a mock token with a public `mint`, so you can fund yourself. Mint 1,000 USDT0
(6 decimals) to your address:

```bash
cast send 0xFc440733d882f28012B190b11Bbec56b44508448 \
  "mint(address,uint256)" <YOUR_ADDRESS> 1000000000 \
  --rpc-url https://testrpc.xlayer.tech \
  --private-key <YOUR_TESTNET_KEY>
```

(`1000000000` = 1,000 × 10^6.) Or use the "Write Contract" tab on the explorer if you prefer not to
touch a key on the command line.

## 4. Use the app

1. Run the app locally against testnet (from `web/`):
   ```bash
   NEXT_PUBLIC_CHAIN=testnet npm run dev
   ```
   (Testnet is the default, so plain `npm run dev` also works.)
2. Open the app, go to the wallet menu, **Connect**. Approve the network add/switch if prompted.
3. **Deposit** tab: enter an amount. First deposit needs a one-time **approve** (lets the pool pull
   your USDT0), then the **deposit** itself. You receive ERC-4626 shares — your claim on the pool.
4. **Overview** shows TVL, idle vs deployed, the risk-adjusted-yield chart, and the agent's latest
   rationale. **Venues** shows each adapter's score and allocation. **Activity** shows the receipt
   trail.
5. **Withdraw** by redeeming shares back to USDT0 at the current share price. Withdrawals never
   consult the agent's budget — you can always exit what is currently recoverable.

## 5. Watch the agent think and act

From `agent/` (with `.env` filled — `RPC_URL`, `VAULT_ADDRESS` = the pool, `AGENT_PRIVATE_KEY` =
the vault's agent key, optional `ANTHROPIC_API_KEY` for the reasoning layer):

```bash
npm run plan    # dry-run: sense → score → reason → plan. Sends NOTHING. Safe to run anytime.
npm run tick    # one live cycle. Sends allocate/deallocate ONLY if EXECUTE=1 and the key == on-chain agent().
npm run loop    # repeat every LOOP_INTERVAL_SECONDS
```

- Start with `npm run plan` — you will see it read live vault state, score both venues, and (with the
  LLM on) reason about the regime, only ever *tightening*.
- To see it **act**: on a freshly redeployed empty pool, deposit some USDT0, set `EXECUTE=1`, and run
  `npm run tick`. With idle to deploy and a clearly-best venue, it will send a real `allocate`. Watch
  the tx on the explorer and the numbers move on the dashboard.
- The agent refuses to send unless its key equals `agent()` on the vault, and every move is
  re-validated by the contract's caps — the worst a bug can do is revert.

## 6. Redeploy the testnet pool from current source (recommended)

To test against the fixed contract (budgets, impairment, redemption isolation):

```bash
cd contracts
# fill the testnet deploy env the script expects (see script/DeployPoolV2Testnet.s.sol header)
forge script script/DeployPoolV2Testnet.s.sol \
  --rpc-url https://testrpc.xlayer.tech \
  --private-key <YOUR_TESTNET_KEY> --broadcast
```

Then repoint both consumers at the new pool address it prints:
- `web/lib/chain.ts` → `ADDR.testnet.pool`
- `agent/.env` → `VAULT_ADDRESS`

Re-mint test USDT0 (§3), deposit (§4), and run the agent (§5) against the fresh pool.

## Safety reminders

- Testnet only. Throwaway wallet, throwaway keys. Never put a mainnet key in `agent/.env`.
- `EXECUTE=0` is the default and sends nothing. Flip to `1` deliberately.
- The public `mint` on the test USDT0 exists only because it is a testnet mock; the mainnet USDT0 has
  no such function.
