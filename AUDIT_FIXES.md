# Aumo audit fixes (agent handoff)

Self-contained fix list from the pre-mainnet audit. Each item: file, location, problem,
fix, and how to verify. Do the Part 1 items before any mainnet deploy. Part 2 items only
gate enabling the USDG swap venue; if you launch Aave-only (recommended), Part 2 can wait.
Run `forge test` after each part. Do not change anything in Part 5 (verified correct).

Repo paths are relative to `contracts/`. Chain is X Layer, chainId 196. Launch artifact is
`AumoPool` via `script/DeployPoolMainnet.s.sol`.

On-chain facts (already verified, do not re-audit): USDT0, USDG, aUSDG are all 6 decimals
on X Layer; all hardcoded Aave/token addresses are correct.

---

## Part 0 — Launch decision (do this, it removes 4 of the findings)

Launch **Aave-only**. In `script/DeployPoolMainnet.s.sol`, do NOT deploy or allowlist the
`RwaUsdgAdapter` for the initial launch. Deploy the Aave adapter only and
`setVenueAllowed(aave, true)`. This neutralizes findings 3, 4, 5, and 6 below (all of which
require the lossy USDG swap venue to be live). Enable USDG later in a separate owner tx once
Part 2 is implemented.

---

## Part 1 — MUST FIX before mainnet (blockers, apply now)

### 1. [HIGH] Ownership must go to a multisig, not the deployer EOA
- File: `script/DeployPoolMainnet.s.sol` (owner wiring) and both contract constructors
  (`src/AumoPool.sol:80`, `src/AumoVault.sol:64`).
- Problem: the pool launches owned by the broadcasting EOA, which controls policy, pause,
  agent rotation, and loss budget. Single hot key = whole trust root for depositor funds.
- Fix: add a `SAFE` (multisig) env var. After deploy, call `transferOwnership(SAFE)`;
  the Safe then calls `acceptOwnership()` (Ownable2Step). This MUST happen before funding
  and before unpause. Add these as explicit script steps or a documented runbook.
- Verify: on-chain `owner() == SAFE` and `pendingOwner() == address(0)` before go-live.

### 2. [HIGH] Agent key must be distinct from owner
- File: `script/DeployPoolMainnet.s.sol` (`vm.envOr("AGENT_ADDRESS", owner)` ~line 41,
  `setAgent` ~line 70).
- Problem: if `AGENT_ADDRESS` is unset it defaults to the owner, so the frequently-signing
  hot key is also the owner. Collapses the "compromised agent can't drain" guarantee.
- Fix: require the agent be set and distinct: `require(agent != owner, "agent==owner")`.
  Set `AGENT_ADDRESS` to a dedicated hot wallet that is never the owner.
- Verify: on-chain `agent()` == intended hot key, `agent() != owner()`.

### 3. [MED] Add a chain guard to every mainnet script
- File: `script/DeployPoolMainnet.s.sol`, `script/DeployMainnet.s.sol`, top of `run()`.
- Problem: hardcoded mainnet addresses with no chain assertion; wrong `--rpc-url` deploys a
  live-looking pool wired to garbage.
- Fix: `require(block.chainid == 196, "not X Layer mainnet");`
- Verify: script reverts on any other chain.

### 4. [MED] Deploy paused, verify, then unpause as the go-live action
- File: `script/DeployPoolMainnet.s.sol` (end of `run()`), `src/AumoPool.sol` (Pausable).
- Problem: pool deploys unpaused and live in one tx, so any misconfig is exploitable before
  you can verify it on-chain.
- Fix: call `pool.pause()` at the end of the deploy script. Unpause only after on-chain
  verification and ownership transfer, from the Safe, as the deliberate public go-live.
- Verify: `paused() == true` immediately post-deploy.

### 5. [MED] SECURITY.md overclaims
- File: `SECURITY.md`.
- Problem: (a) lists an on-chain "owner-set risk band" guardrail that does not exist in the
  contracts; (b) presents the loss budget as bounding all agent value destruction and as a
  total, when it is a per-epoch RATE limit reachable only on the agent `deallocate` path;
  (c) "withdrawals never blocked / exits always work" is conditional (see finding 6).
- Fix: remove the "owner-set risk band" line (or mark it off-chain agent policy); describe
  the loss budget as a per-epoch rate limit on the agent deallocate path; state plainly that
  the owner is trusted (a malicious allowlisted venue plus `setAgent(self)` can rug), so
  depositor safety rests on which venues get allowlisted; soften the "exits always work"
  claim to note a venue whose exit swap reverts (USDG depeg) can block redemptions until the
  owner acts.
- Verify: doc matches code.

---

## Part 2 — MUST FIX before enabling the USDG swap venue (defer with the venue)

### 6. [HIGH] `_ensureIdle` has no per-venue error isolation, so one stuck venue bricks all redemptions
- File: `src/AumoPool.sol:183-211` (`_ensureIdle`), the `_doDeallocate(v, pull, false)` call
  at line 206; the adapter call is `src/AumoPool.sol:346`.
- Problem: if a venue `withdraw` reverts (USDG depeg past `maxSlippageBps`, or Aave reserve
  paused), the whole redemption reverts, even when another venue (Aave) could cover it.
- Fix: wrap the per-venue retreat in try/catch so a reverting venue is skipped, not fatal.
  Extract the external withdraw into an external function on the pool (e.g.
  `this.tryDeallocate(v, pull)` guarded to self-only) or refactor `_doDeallocate` so the
  external `IVenueAdapter(venue).withdraw(...)` sits in a `try this.<fn>() { } catch { }`.
  Continue the loop on catch. Apply the same isolation to the agent `deallocate` path.
- Verify: add a test with a venue whose `withdraw` reverts; redemption still succeeds by
  pulling from a healthy venue.

### 7. [HIGH] `maxSlippageBps` immutable with no rescue can permanently strand USDG funds
- File: `src/adapters/RwaUsdgAdapter.sol:50` (immutable), `:113-123` (`withdraw`).
- Problem: a USDG depeg beyond the fixed floor makes the exit swap always revert, and there
  is no owner lever to widen slippage or emergency-exit, so funds are stuck.
- Fix: give the adapter an owner (OpenZeppelin `Ownable`, owner = the pool's owner/Safe) and
  make `maxSlippageBps` owner-settable, OR add an owner-only `emergencyWithdraw(minOut)` that
  accepts a caller-supplied floor for a controlled exit at a haircut. Keep the default floor
  strict for normal operation.
- Verify: owner can exit the venue under a simulated depeg.

### 8. [HIGH] Loss budget is bypassable via the user-withdrawal path
- File: `src/AumoPool.sol:334-360` (`_doDeallocate`, the `if (enforce && ...)` meter at
  352-360), reached with `enforce=false` from `_ensureIdle` at line 206.
- Problem: the loss budget only charges agent-initiated `deallocate` (`enforce=true`). A
  compromised agent who is also a depositor can allocate into the lossy venue then redeem to
  force an unmetered retreat, bleeding realized swap loss to all holders, unbounded.
- Fix (pick one, do not meter the exit path itself or you break redemptions):
  (a) add an allocate-side per-epoch "deploy budget" mirroring the loss budget, so the agent
  cannot re-stage churn faster than a set rate; or
  (b) accumulate realized socialized loss on the `enforce=false` path into a counter and
  auto-`_pause()` (which blocks `allocate` only, exits stay open) when it crosses a
  threshold, so the agent cannot re-stage more churn.
- Verify: a test that loops deposit -> agent allocate -> redeem cannot realize more than the
  configured bound before allocate is blocked.

### 9. [MED] Valuation haircut (200 bps) is far larger than real exit cost (~2-4 bps), creating a front-runnable NAV step
- File: `src/adapters/RwaUsdgAdapter.sol:131-134` (`balanceOf`), used by
  `src/AumoPool.sol:99-109` (`totalAssets`).
- Problem: `balanceOf` discounts by the full `maxSlippageBps`, so every allocate marks NAV
  down ~2% and every deallocate marks it back up. Deposit/redeem timing skims that reversal
  from existing depositors, and it is an agent-controlled repeatable swing.
- Fix: decouple the valuation discount from the swap floor. Add a separate, smaller
  `valuationDiscountBps` (~30-50, the realistic marginal round-trip cost) used only in
  `balanceOf`, and keep `maxSlippageBps` for the actual swap `minOut`. Set it in the
  constructor/deploy.
- Verify: allocate/deallocate of a given amount moves `totalAssets` by no more than the real
  round-trip cost.

---

## Part 3 — Hardening (recommended, not blockers)

### 10. [LOW] Validate `maxSlippageBps` and token decimals in the RWA adapter constructor
- File: `src/adapters/RwaUsdgAdapter.sol:59-77`.
- Fix: `require(maxSlippageBps_ > 0 && maxSlippageBps_ < 10_000, "bad slippage");` and
  `require(IERC20Metadata(usdg_).decimals() == IERC20Metadata(token_).decimals(), "dp");`
  (import `IERC20Metadata`). Decimals match today, this prevents a future misconfig.

### 11. [LOW] Zero out the Aave pool approval after supply
- File: `src/adapters/AaveV3Adapter.sol:47-48`, `src/adapters/RwaUsdgAdapter.sol:106-107`.
- Fix: add `token.forceApprove(address(pool), 0);` (Aave) and
  `usdg.forceApprove(address(pool), 0);` (RWA) after the `supply` call, matching the vault's
  "never leave a standing allowance" discipline.

### 12. [MED] `removeVenue` can strand value
- File: `src/AumoPool.sol:239-257`.
- Fix: guard with `if (IVenueAdapter(venue).balanceOf(address(this)) > DUST) revert
  VenueHasValue();` and add a separate explicit `forceRemoveVenue` (owner, acknowledged) for
  the genuinely-bricked-adapter case that `removeVenue` exists to handle.

### 13. [LOW] `totalAssets` try/catch defense-in-depth
- File: `src/AumoPool.sol:99-109`.
- Fix: wrap each `IVenueAdapter(_venues[i]).balanceOf(...)` in try/catch, treating a revert
  as 0, so a broken adapter cannot brick pricing/exits before the owner prunes. Safe given
  current adapters cannot be made to revert by a third party; re-check this if you ever add
  an adapter whose `balanceOf` can be externally forced to revert.

### 14. [LOW] `setAgent` zero-address and agent rotation on ownership transfer
- File: `src/AumoPool.sol:215`, `src/AumoVault.sol:88`.
- Fix: either add `if (agent_ == address(0)) revert ...` or keep zero as a documented
  "freeze agent" mechanism. Add to the ownership-transfer runbook: the new owner must call
  `setAgent` (the constructor default leaves the old owner as agent after a transfer).

### 15. [INFO] AumoVault has no loss budget
- File: `src/AumoVault.sol:154-171` (`deallocate`).
- Fix: never allowlist a swap-based (lossy) venue on an `AumoVault`; keep it Aave-only. If a
  lossy venue is ever needed there, port the `maxEpochLoss` loss meter from `AumoPool` first.
  Consider deleting or clearly marking `script/DeployMainnet.s.sol` (the Vault script) as
  non-launch so only the Pool ships.

### 16. [LOW] Loss budget window
- File: `src/AumoPool.sol:352-360`.
- Fix (optional): the tumbling window allows ~2x budget across a reset boundary. Consider a
  sliding window and/or a cumulative kill threshold that auto-pauses allocate. At minimum,
  document it as a rate limit (covered in finding 5).

---

## Part 4 — Deploy runbook (after fixes, Aave-only)

Before broadcast: `AGENT_ADDRESS` set and distinct from owner; caps chosen; `--rpc-url` is
X Layer mainnet. After broadcast, assert on-chain: `asset()==USDT0`; `owner()==EOA`,
`agent()==hot key != owner`; caps and loss budget non-zero and sane; `venueAllowed(aave)`
true and `venueAllowed(usdg)` false; adapter wiring correct; `paused()==true`. Then
`transferOwnership(SAFE)` -> Safe `acceptOwnership()` -> verify `owner()==SAFE`,
`pendingOwner()==0` -> seed a tiny first deposit -> `unpause()` from the Safe.

---

## Part 5 — Verified correct, DO NOT CHANGE

Custody (agent surface is only allocate/deallocate; no agent path names a recipient; agent
cannot mint/burn/redeem or withdraw to itself; rotation instantly revokes old key; Pool has
no owner-withdraw). Caps enforced and not bypassable by repeated calls; `totalDeployed ==
sum allocated` invariant. Pause covers allocate/deposit/mint, leaves exits open. Direct
agent churn metered by the loss budget (fails closed at 0). First-depositor inflation
mitigated (`_decimalsOffset()==6`). Reentrancy guards + CEI on all state paths.
`renounceOwnership` disabled; Ownable2Step. Aave adapter valued 1:1 correctly. Approvals
zeroed after allocate on the vault/pool side. Token addresses and decimals correct on X
Layer. Do not "fix" these; changing them risks regressions.
