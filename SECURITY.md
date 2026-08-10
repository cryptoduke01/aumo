# Security

Aumo moves real funds. Safety is a product feature, not an afterthought.

## Trust model

Control lives in the contract, not the agent.

- The **vault** custodies funds and enforces policy. The **agent** only proposes and submits
  actions; it holds no special authority.
- Every allocation is bounded onchain by: allowlisted venues, per-move cap, per-venue cap, global
  cap, a per-epoch loss budget, owner-set risk band, and a pause switch.
- The agent cannot exceed policy, use a non-allowlisted venue, or withdraw to an arbitrary address.
  If the agent key is lost or compromised, funds cannot leave the allowed venues or reach the
  attacker; the caps and the no-external-withdrawal rule hold.

### Churn / value-destruction bound

Custody is not the only thing worth protecting: a venue that swaps (the RWA USDG route) loses a
small spread on each round trip, so a compromised agent that cannot *steal* funds could still try
to *destroy* value by churning allocate→deallocate. The caps bound position size, not frequency,
so on their own they do not stop this.

The pool therefore meters agent-driven realized loss against a rolling **per-epoch loss budget**
(`maxEpochLoss` per `lossEpochLength`, owner-set). Once an epoch's budget is spent, further lossy
agent retreats revert; the owner rotates the agent key (`setAgent`, which revokes instantly) long
before meaningful value is lost. The budget defaults to fail-closed (zero) until the owner sets it.
Crucially, **user withdrawals never consult this budget**, so depositors can always exit even when
the agent's budget is exhausted or the pool is paused. Realizable venue value is reported net of
the exit swap cost, so share pricing is honest and a depositor who exits first cannot leave the
round-trip cost for those who remain.

## Onchain

- `SafeERC20` for all token movement; checks-effects-interactions; reentrancy guards on state-changing paths.
- Withdrawals from venues return directly to the vault, never to the agent.
- Dependencies pinned to audited libraries (OpenZeppelin).
- Every state-changing action emits an event (the onchain receipt).

## Keys & secrets

- Secrets never enter the repository. `.env` / `.env.local` are gitignored; only `.env.example`
  (placeholders) is committed.
- The deploy/agent key is testnet-scoped during development and stored locally only.
- Production keys are held in the deployment platform's secret store, never in code or CI logs.

## Off-chain (agent & API)

- The agent is rate-limited on RPC and market-data calls with backoff, and treats every external
  read as untrusted (validated before use).
- Public API endpoints are rate-limited per IP/key and return no secrets.
- No user custody: Aumo never holds a user's private key.

## Process

- Testnet first, then mainnet. Bounded balances before scale.
- Code review before any deploy. Third-party review targeted before mainnet scale.

## Reporting a vulnerability

Email **info@aumo.finance** with details and reproduction. Please do not open a public issue
for security reports. We aim to acknowledge within 48 hours.
