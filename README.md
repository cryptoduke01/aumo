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
2. **Sense** — the agent reads live yields and risk across allowlisted venues.
3. **Decide** — it ranks venues by risk-adjusted yield, within your policy.
4. **Act** — it rebalances through the vault into the best venue.
5. **Prove** — every move emits an onchain receipt.

## Trust model

Aumo moves real funds, so control lives in the contract, not the agent. The agent can only ever
act inside limits the owner sets onchain:

- Allowlisted venues only.
- Per-move, per-venue, and global caps.
- Owner-set risk band.
- Pause / kill-switch.

The agent can never exceed policy, touch a non-allowlisted venue, or withdraw to an arbitrary
address. Remove the agent and the funds are still safe.

## Architecture

| Package      | What it is                                                                        |
| ------------ | --------------------------------------------------------------------------------- |
| `contracts/` | `AumoVault` + venue adapters (Solidity / Foundry). The vault holds funds and enforces policy; adapters wrap yield venues (Aave, STBL). |
| `agent/`     | The off-chain decision loop (TypeScript). Reads market data, proposes allocations within policy, submits transactions. |
| `web/`       | The dashboard (Next.js). Positions, the agent's reasoning, and receipts.          |

## Quickstart

```bash
# contracts
cd contracts
forge build
forge test
```

Deploy to X Layer (config in `contracts/.env.example`):

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $XLAYER_RPC --private-key $PRIVATE_KEY --broadcast
```

## Security

Funds are guarded by the contract, not the agent. Secrets never live in the repo. Testnet before
mainnet, review before deploy. See [SECURITY.md](SECURITY.md).

## Built with

Solidity · Foundry · TypeScript · viem · Next.js · X Layer · USDT0 · Aave · STBL · Chainlink Data Streams

## License

MIT — see [LICENSE](LICENSE).
