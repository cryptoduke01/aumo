# Security

Aumo moves real funds. Safety is a product feature, not an afterthought.

## Trust model

Custody lives in the contract, not the agent. Policy lives with the owner.

- The **pool** custodies funds and enforces guardrails. The **agent** only proposes and submits
  allocate/deallocate actions; it holds no special authority and no path to an outside address.
- Every allocation is bounded onchain by: allowlisted venues, per-move cap, per-venue cap, global
  cap, a per-epoch loss budget, a per-epoch deploy budget, and a pause switch. (Risk bands and
  appetite are *off-chain* agent policy that can only tighten these onchain limits, never loosen
  them; they are not themselves enforced onchain.)
- The agent cannot exceed policy, use a non-allowlisted venue, or withdraw to an arbitrary address.
  If the agent key is lost or compromised, funds cannot leave the allowed venues or reach the
  attacker; the caps and the no-external-withdrawal rule hold.

### The owner is trusted

Depositor safety ultimately rests on the owner. The owner chooses which venues are allowlisted, and
a malicious or buggy allowlisted venue combined with `setAgent(self)` could route funds to loss.
So the owner is a trusted role: it holds ownership through a multisig (the deploy hands ownership to
a Safe via `Ownable2Step`), renouncing is disabled, and the pool ships **paused** so nothing is live
until the multisig verifies the wiring and unpauses. What the owner cannot do: directly withdraw
depositor funds to itself (there is no owner-withdraw path).

### Churn / value-destruction bound

A swap venue (the RWA USDG route) loses a small spread on each round trip, so a compromised agent
that cannot *steal* funds could still try to *destroy* value by churning allocate→deallocate. Caps
bound position size, not frequency, so two rolling **per-epoch rate limits** bound the damage:

- **Loss budget** (`maxEpochLoss` per `lossEpochLength`): meters realized round-trip loss on the
  *agent* `deallocate` path. Once the epoch's budget is spent, further lossy agent retreats revert.
  Defaults to fail-closed (zero) until the owner sets it.
- **Deploy budget** (`maxEpochDeploy`): caps how much the agent can *allocate* per epoch. The
  redeem exit path is intentionally unmetered (so exits never block), which alone would let a
  compromised agent who is also a depositor socialize swap loss by looping deposit→allocate→redeem.
  Capping deploy throughput bounds how fast that churn can be re-staged.

Both are *rate* limits per rolling window, not lifetime totals; across a window boundary up to
about two budgets can be realized before the owner rotates the key (`setAgent`, which revokes
instantly). **User withdrawals never consult either budget**, so depositors can always exit.

Realizable venue value is reported net of a small valuation discount (the realistic marginal
round-trip cost, decoupled from the larger swap floor), so share pricing is honest and a depositor
who exits first cannot leave the round-trip cost for those who remain. Redemptions are isolated
per venue: a venue whose exit reverts (a USDG depeg past the swap floor, a paused Aave reserve) is
skipped so a healthy venue still covers the exit. Value stranded in such a venue is realized once
the owner widens the adapter's slippage or calls its `emergencyWithdraw`; until then that portion,
and only that portion, is illiquid.

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
