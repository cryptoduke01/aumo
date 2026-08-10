# Aumo pre-mainnet security audit

Researcher: Duke (@dukedotsol). Method: Kensho, five independent review lenses plus a
full line-by-line read and on-chain verification on X Layer (chainId 196). Fork and
read-only proof only. Date: 2026-08-10 (same-day mainnet launch).

Artifact under launch: `AumoPool` (ERC-4626) via `script/DeployPoolMainnet.s.sol`, wired
with the Aave adapter and the `RwaUsdgAdapter`, loss budget set. `AumoVault` is the
single-owner variant (Aave-only in its own script).

## Verdict: NO-GO as currently scripted. GO on an Aave-only launch plus two deploy fixes.

The contracts are well-built. Custody is sound, share math is sound, and every headline
custody claim holds. The real risks cluster in one place: the `RwaUsdgAdapter` (USDG swap
venue). Four separate findings across three lenses all trace back to it. Launching
Aave-only removes all four at once and is the recommended path to ship today.

## On-chain facts verified
- USDT0 `0x779D...3736` decimals = 6. USDG `0x4ae4...2dc8` decimals = 6. aUSDG
  `0x2287...2223` decimals = 6. Chain = 196. The RWA adapter's 1:1 same-decimals
  assumption is CORRECT (this was the highest-blast-radius unknown; it is clean).
- All hardcoded Aave/token addresses match aave-address-book AaveV3XLayer.

## Findings

| ID | Sev | Lens | Summary | Must-fix before mainnet |
|----|-----|------|---------|--------------------------|
| D1 | HIGH | deploy | Owner is the deployer EOA; no step to hand ownership to a multisig | YES |
| D2 | HIGH | deploy | Agent key silently defaults to owner if `AGENT_ADDRESS` unset (collapses privilege separation) | YES |
| G-A | HIGH | guardrails | Loss budget is bypassable via the user-withdrawal path: a compromised-agent-as-depositor churns the lossy venue unmetered | YES if USDG venue live |
| A-H | HIGH | adapters | A reverting venue withdraw (USDG depeg past 2%, or Aave pause) bricks ALL redemptions; `maxSlippageBps` immutable, no rescue, can strand funds | YES if USDG venue live |
| B/osc | MED | access + guardrails | RWA `balanceOf` discounts 200 bps vs ~2-4 bps real cost, creating a repeatable agent-controlled NAV swing that skims value between depositors | YES if USDG venue live |
| A-M | MED | adapters | `balanceOf` ignores USDG depeg, so a new depositor during a depeg overpays (mitigated by pause) | No |
| DC1 | MED | deploy | Pool deploys unpaused/live in one tx, no verify gate before money can enter | No (do it) |
| DC2 | MED | deploy | No `require(block.chainid == 196)` guard | No (do it) |
| DOC | MED | deploy + guardrails | SECURITY.md claims an on-chain "owner-set risk band" that does not exist in code | No (fix doc) |
| AC3 | MED | access | `removeVenue` can strand value if a venue still holds funds (owner foot-gun) | No |
| L1 | LOW | adapters | `maxSlippageBps` unvalidated (`==10000` gives zero floor, `>10000` bricks) | No (add require) |
| L2 | LOW | access | adapters leave a self-consuming Aave approval un-zeroed | No |
| L3 | LOW | guardrails | Loss budget bounds a rate, not a cumulative total; tumbling window allows ~2x burst | No (doc) |
| L4 | LOW | access | `setAgent` no zero-address guard; ownership transfer does not auto-rotate agent | No (runbook) |
| V1 | INFO | access | Owner is fully trusted: a malicious allowlisted venue + `setAgent(self)` can rug. Inherent to the adapter model; state it plainly in docs | No |
| VLT | INFO | adapters + guardrails | `AumoVault` has no loss budget; never allowlist a swap venue on a Vault | No (gate) |

## The decision that clears the board: launch Aave-only today

D1 and D2 are unavoidable deploy-hygiene blockers. Everything else HIGH or MED
(G-A, A-H, B/osc, A-M) exists only because the USDG swap venue is allowlisted on day one.
Aave is lossless and 1:1, so with USDG deferred:
- no swap-exit revert, so no redemption brick (A-H gone),
- no realized round-trip loss, so no unmetered churn (G-A gone),
- no phantom NAV haircut, so no oscillation skim (B/osc gone),
- no depeg mispricing (A-M gone).

Ship the fork-proven Aave path today. Enable USDG in a later owner tx once the USDG-only
fixes below are in.

## Launch checklist (Aave-only, today)
1. Deploy from EOA, then `transferOwnership(SAFE)` and `acceptOwnership()` from the Safe
   BEFORE funding and BEFORE unpause. Verify `owner() == SAFE` on-chain. (D1)
2. Set `AGENT_ADDRESS` to a distinct dedicated hot key, never the owner. Add
   `require(agent != owner)` to the script. Verify `agent()` on-chain. (D2)
3. Do not allowlist `RwaUsdgAdapter`. Aave only.
4. Add `require(block.chainid == 196)` to the script. (DC2)
5. Deploy paused, verify all params on-chain (asset, owner, agent, caps, loss budget,
   venue wiring), then `unpause()` from the Safe as the deliberate go-live. (DC1)
6. Correct SECURITY.md: remove the "owner-set risk band" on-chain claim, and state the
   loss budget is a per-epoch RATE limit, not a cumulative cap. (DOC, L3, V1)
7. Seed a tiny first deposit yourself to lock the ERC-4626 share price (belt and braces
   on top of `_decimalsOffset()==6`).

## Before enabling the USDG venue later (do not ship these same-day)
- G-A: bound the inflow the attacker needs (allocate-side per-epoch deploy budget), or
  meter socialized loss on the `enforce=false` withdrawal path and auto-pause `allocate`
  (never exits) when a threshold trips.
- A-H: wrap each venue `withdraw` in `_ensureIdle` (and agent `deallocate`) in try/catch
  so one stuck venue is skipped, not fatal; make `maxSlippageBps` owner-settable or add an
  owner-only emergency-exit with a caller-supplied floor.
- B/osc: decouple the NAV valuation haircut from the swap `minOut` floor; value the
  position at the realistic marginal round-trip cost (~30-50 bps), keep the aggressive
  floor only for the actual swap.
- L1: `require(maxSlippageBps > 0 && maxSlippageBps < 10_000)` and a constructor
  `require(decimals(usdg) == decimals(token))`.
- AC3: `removeVenue` value guard.

## Verified intact (do not re-chase)
Custody: agent surface is exactly `allocate` + `deallocate`; no agent path names a
recipient or sends funds anywhere but an owner-allowlisted venue or back to the pool;
rotation instantly revokes the old key; Pool has no owner-withdraw. Caps (per-move, per-
venue, global) enforced and not bypassable by repeated calls; `totalDeployed == sum
allocated` invariant holds. Pause covers allocate/deposit/mint, leaves exits open.
Direct agent churn is metered by the loss budget (fails closed at 0). First-depositor
inflation mitigated (`_decimalsOffset()==6`). `totalAssets` DoS recoverable via
`removeVenue`. Reentrancy guards + CEI on all state paths. `renounceOwnership` disabled;
Ownable2Step. Aave adapter valued 1:1 correctly. Approvals zeroed after allocate.
