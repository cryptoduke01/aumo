<div align="center">

# Aumo

**Autonomous RWA-yield agent for stablecoins on X Layer.**

Deposit USDT0. Aumo puts it to work in tokenized real-world-asset yield, rebalances on its
own inside strict guardrails, and proves every move onchain.

_Give a stablecoin a job._

[aumo.finance](https://aumo.finance) · [@aumofinance](https://x.com/aumofinance) · Built on X Layer

</div>

---

## Overview

Idle stablecoins earn nothing, and managing them across onchain RWA venues is constant manual
work: compare yields, weigh risk, move funds, watch for changes, repeat. Aumo is an autonomous
agent that does that for you, within limits you set, and leaves a verifiable onchain receipt for
every action. It is an agent you can hand money to.

## How it works

1. **Deposit** — fund the vault with USDT0 and set a risk band.
2. **Sense** — the agent reads live vault state and market data across allowlisted venues.
3. **Score** — a risk engine haircuts each venue's yield by protocol, liquidity, peg, utilization, and concentration risk, and ranks on risk-adjusted yield, not headline APY.
4. **Reason** — an optional LLM layer reads the market regime and may only make the plan more conservative; it can never loosen a guardrail or add a venue.
5. **Act & prove** — it rebalances through the vault within your caps, emits an onchain receipt per move, and records the full reasoning trail off-chain, bound to a fingerprint of the exact policy in force.

## Trust model

Aumo moves real funds, so control lives in the contract, not the agent. The agent can only ever
act inside limits the owner sets onchain:

- Allowlisted venues only.
- Per-move, per-venue, and global caps.
- Owner-set risk band.
- Pause / kill-switch.

The agent can never exceed policy, touch a non-allowlisted venue, or withdraw to an arbitrary
address. Remove the agent and the funds are still safe.

Two more properties make it auditable: every move carries a plain-language rationale, and every
decision is stamped with a fingerprint of the exact guardrails that governed it, so the reasoning
trail can be checked against the policy that was in force.

## Architecture

| Package      | What it is                                                                        |
| ------------ | --------------------------------------------------------------------------------- |
| `contracts/` | `AumoVault` + venue adapters (Solidity / Foundry). The vault holds funds and enforces policy; the Aave v3 adapter is fork-tested against live Aave on X Layer mainnet. |
| `agent/`     | The reasoning brain (TypeScript / viem): sense, risk engine, allocator, optional LLM reasoning, on-chain executor, and an audit trail. |
| `web/`       | The dashboard (Next.js). Positions, the agent's reasoning, and receipts.          |

## Quickstart

```bash
# contracts
cd contracts
forge build
forge test                                   # offline unit tests
RUN_FORK=1 forge test --match-path 'test/fork/*'   # against live Aave on X Layer mainnet
```

```bash
# agent
cd agent
npm install
cp .env.example .env     # fill RPC_URL, VAULT_ADDRESS, AGENT_PRIVATE_KEY (testnet throwaway)
npm run identity         # the agent's identity card
npm run plan             # sense, score, reason — never sends a transaction
npm test                 # risk engine, allocator caps, and the tighten-only safety kernel
```

Deploy the vault + Aave adapter to X Layer mainnet (config in `contracts/.env.example`, real capital):

```bash
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url $XLAYER_MAINNET_RPC --private-key $PRIVATE_KEY --broadcast
```

## Security

Funds are guarded by the contract, not the agent. Secrets never live in the repo. Testnet before
mainnet, review before deploy. See [SECURITY.md](SECURITY.md).

## Built with

Solidity · Foundry · TypeScript · viem · Next.js · X Layer · USDT0 · Aave · STBL · Chainlink Data Streams

## License

MIT — see [LICENSE](LICENSE).
