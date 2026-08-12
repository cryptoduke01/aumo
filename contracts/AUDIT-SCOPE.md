# Aumo — Audit Scope

Handoff for an external smart-contract audit. Aumo is an autonomous stablecoin treasury on X Layer:
depositors put USDT0 into a pooled ERC-4626 vault, and an off-chain agent (a Turnkey-held key,
restricted to two functions) allocates the pooled balance across allowlisted yield-venue adapters,
within caps enforced by the contract. The agent can never exceed a limit or move funds anywhere but
the allowlisted venues and back.

## Build & target
- **Commit under audit:** `84d4379b4bd08c5145b2b56cba28599efd42f453`
- **Compiler:** solc `0.8.24`, optimizer on (200 runs), **`via_ir = true`** (required — Pendle's
  nested router structs overflow the legacy codegen; it will not compile without IR).
- **Dependencies:** OpenZeppelin Contracts `5.7.0` (Ownable2Step, Pausable, ReentrancyGuard, SafeERC20).
- **Chain:** X Layer mainnet, chainId 196. RPC `https://rpc.xlayer.tech`.

## In scope (deployed, handles real funds) — ~784 SLOC
| Priority | File | SLOC | Role |
|---|---|---|---|
| 1 | `src/AumoPool.sol` | 313 | Multi-depositor ERC-4626 vault: deposit/withdraw/redeem, shares, `allocate`/`deallocate`, per-move/per-venue/total caps, loss + deploy budgets, `setVenueImpaired`, `removeVenue`, pause. |
| 2 | `src/adapters/PendlePtAdapter.sol` | 288 | Pendle PT-USDG fixed-yield venue. USDT0→USDG→PT; TWAP-oracle NAV (fail-open to last good rate); market-sell pre-maturity or 1:1 redeem after; owner emergency exit. |
| 3 | `src/adapters/RwaUsdgAdapter.sol` | 134 | USDG (Global Dollar / Paxos, RWA-backed) venue: USDT0↔USDG on Uniswap v3, supplied to Aave v3. |
| 4 | `src/adapters/AaveV3Adapter.sol` | 42 | Aave v3 USDT0 lending venue. |
| 5 | `src/interfaces/IVenueAdapter.sol` | 7 | Uniform adapter interface (asset/deposit/withdraw/balanceOf). |

## Out of scope
- `src/AumoVault.sol` (119 SLOC) — legacy single-owner vault, **NOT deployed on mainnet** (absent from
  `script/DeployPoolMainnet.s.sol`). Superseded by AumoPool. Audit only if it will be deployed.
- External protocols (trusted, audited elsewhere): Aave v3 Pool, Uniswap SwapRouter02, Pendle Router
  V4 / market / PT oracle, USDT0 & USDG tokens. **The integration seams are in scope** (adapter call
  correctness, oracle/slippage assumptions), the third-party contracts themselves are not.
- OpenZeppelin 5.7.0.
- `agent/` (off-chain TypeScript agent) and `web/` (frontend) — separate review if desired.
- `test/`, `script/` — reference, not production code (see below).

## Trust model (classify these as trust findings, not vulnerabilities)
- **Owner** = a cold EOA (Ownable2Step; will migrate to a Safe). Powers: `pause`, `setVenueImpaired`
  (writes a venue down in NAV under a depeg), `emergencyWithdraw` (per adapter, oracle-independent),
  `setVenueAllowed`/`removeVenue`, retune slippage/valuation. Owner is trusted.
- **Agent** = a Turnkey-held key, restricted by a Turnkey signing policy to `allocate`/`deallocate`
  on the pool only. Cannot withdraw to any external address.
- **USDG peg** = assumed near $1. There is deliberately **no on-chain peg oracle** (it would add its
  own risk); a depeg is an owner-monitored operational event (`setVenueImpaired`/`pause`). Documented.
- **Pendle** = trusted external dependency; a Pendle market freeze can strand the Pendle position
  until unpause/maturity (bounded, owner escape via `emergencyWithdraw`).

## Prior work — please review, do not re-report
- Internal security pass (methodology: kensho) + a Foundry **invariant suite**
  (`test/AumoPoolInvariant.t.sol`: per-venue cap, total-deployed cap, accounting consistency, shares
  backed, claims within assets — 128k fuzzed ops).
- **Fork tests** against live X Layer (`test/fork/`): Aave, USDG, and Pendle round-trips proven on
  real mainnet contracts, plus a Pendle oracle-revert fail-open test.
- Two PendlePtAdapter findings already fixed at this commit: (1) PT valuation clamped to par (≤1e18)
  to bound oracle overvaluation; (2) `balanceOf` fails open to the last good rate so a Pendle oracle
  revert cannot brick the pool's `totalAssets` (money-path still fails closed).

## Suggested focus areas
- Share accounting / first-depositor & donation resistance in AumoPool (virtual-offset).
- `allocate`/`deallocate` accounting vs. live venue balances; `totalAssets` under a venue revert.
- Adapter NAV correctness and the entry/exit swap-cost / valuation-discount handling.
- The Pendle TWAP-oracle dependency and the fail-open path.
- Loss-budget / deploy-budget bounds and the redeem path vs. churn re-staging.
- Reentrancy across the pool↔adapter↔external-router boundary.
