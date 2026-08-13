# Aumo mainnet deploy runbook

Not a deploy trigger. This records the finalized config and the exact steps, so the actual launch is
mechanical when we decide to go. X Layer mainnet, chainId 196, RPC `https://rpc.xlayer.tech`.

## Roles (public addresses)

| Role | Address | Notes |
|---|---|---|
| **Owner** (crown jewel) | `0x9471A4ea01f51d01749D9E9696b973faf27a96AE` | fresh dedicated cold EOA; seed saved offline; used for owner actions only. Upgrade to hardware/Safe later via `transferOwnership` (Ownable2Step). |
| **Agent signer** | `0x2647904345d00Ef30d831935b913E5df1D58af67` | Turnkey-held key (org `b072be8b-…`, wallet `57537868-…`). Restricted by the signing policy to allocate/deallocate on the pool. Live-proven on testnet. |
| Asset (USDT0) | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | canonical X Layer USDT0 |

Venue adapter targets (Aave v3, USDG, Pendle PT-USDG, Uniswap SwapRouter02) are hardcoded and
fork-verified in `script/DeployPoolMainnet.s.sol` / the adapters. Three venues deploy: AaveV3Adapter,
RwaUsdgAdapter, PendlePtAdapter.

### Pendle launch precondition (important)
The Pendle PT-USDG market is new, and its price TWAP oracle needs bootstrapping before the agent can
value or allocate there. Before the agent touches Pendle on mainnet:
1. Call `PENDLE_MARKET.increaseObservationsCardinalityNext(cardinalityRequired)` once (permissionless),
   where `cardinalityRequired` comes from `PendlePtOracle.getOracleState(market, 900)`.
2. Wait until `getOracleState(market, 900)` returns `oldestObservationSatisfied = true`.
Until then, `getPtToAssetRate` reverts (`OracleTargetTooOld`) and any allocate/NAV read on Pendle
fails. **Recommended launch order:** allowlist Aave + USDG first, run a few clean cycles, then
allowlist Pendle once its oracle is satisfied (or verify the oracle is already satisfied at deploy —
the market has been live since 2026-08-11, so by launch it likely is; check, don't assume).

### USDG peg source (agent-side, F-2) — optional robustness bump
The agent measures USDG's deviation from $1 live from the USDT0/USDG Uniswap v3 pool
`0x0cBe0dBE1400e57f371a38BD3b9bC80F7C3676dA` (fee 100), preferring a 300s TWAP (`pegSource` in
`agent/config/venues.mainnet.json`). The reader is fail-conservative: if the TWAP can't be served it
falls back to spot and reports the peg **unverified**, which makes the risk engine floor peg risk
(the agent stays cautious) rather than trust a value. Verified live today
(`{pegDeviationBps:10, verified:true, source:"twap"}`). The pool's observation cardinality is 1, so
for a rock-solid TWAP you may optionally call `increaseObservationsCardinalityNext(60)` on that pool
once (permissionless, ~one cheap tx) and let it fill — not required, purely to keep the reading
`verified` under heavy pool activity instead of degrading to the conservative floor.

## Pre-deploy checklist

- [ ] **Rotate the Turnkey API key** (delete "Aumo", create fresh); delete the downloaded creds JSON.
- [ ] Create a **non-root Turnkey user** for the agent; record its `user_id` as `TURNKEY_AGENT_USER_ID`.
- [ ] Fund the **owner** `0x9471…` with a little OKB (deploy gas).
- [ ] Fund the **agent** `0x2647…` with a little OKB (allocate/deallocate gas).
- [ ] Set the Railway agent secrets: `ANTHROPIC_API_KEY`, the (rotated) `TURNKEY_*`, `RECEIPTS_DIR=/data` (+ volume).
- [ ] (Recommended) complete a **formal third-party audit** before funding with real deposits.

## Deploy (paused, owner is the cold EOA)

```bash
cd contracts
VAULT_OWNER=0x9471A4ea01f51d01749D9E9696b973faf27a96AE \
AGENT_ADDRESS=0x2647904345d00Ef30d831935b913E5df1D58af67 \
forge script script/DeployPoolMainnet.s.sol \
  --rpc-url https://rpc.xlayer.tech --broadcast
# broadcast from the owner key 0x9471 (it is VAULT_OWNER = initial owner)
```

The script guards `block.chainid == 196`, requires `AGENT_ADDRESS != owner`, sets the loss + deploy
budgets, and deploys **PAUSED**. Since `VAULT_OWNER` is already the cold owner, no ownership transfer
is needed (leave `SAFE` unset; the script's "move to a multisig" warning is expected here).

## Post-deploy

1. Verify on-chain: `owner() == 0x9471…`, `agent() == 0x2647…`, `paused() == true`.
2. **Apply the Turnkey signing policy** (see `agent/turnkey/SIGNING-POLICY.md`):
   ```bash
   cd agent
   AUMO_POOL=<new pool> TURNKEY_AGENT_USER_ID=<agent user id> \
   TURNKEY_ORGANIZATION_ID=b072be8b-cb5a-4cab-8e60-2774cc90068f \
   TURNKEY_API_PUBLIC_KEY=<admin key> TURNKEY_API_PRIVATE_KEY=<...> \
   npx tsx scripts/turnkey-create-policy.ts
   ```
3. Point the app + agent at the new pool:
   - `web`: `NEXT_PUBLIC_CHAIN=mainnet`, `NEXT_PUBLIC_POOL=<new pool>`.
   - `agent`/Railway: `CHAIN_ID=196`, `CHAIN_NAME=X Layer`, `RPC_URL=https://rpc.xlayer.tech`,
     `VAULT_ADDRESS=<new pool>`, `VENUES_FILE=mainnet`, the `TURNKEY_*` secrets, `EXECUTE=1`.
4. Seed the pool with a small real USDT0 deposit, sanity-check `totalAssets`, run one agent `plan`.
5. **Unpause** (owner) when ready to go live.

## Operational safeguards (from the pre-launch audit)

The money-path audit found the core clean (no Critical/High). Two items are owner-operational, not
code bugs, and belong in the live runbook:

- **USDG depeg monitoring (the one real decision).** NAV marks the RWA venue at a fixed ~30bps
  valuation discount and assumes USDG holds its peg; there is no on-chain peg oracle by design (an
  oracle would add its own risk). If USDG depegs beyond that discount, early redeemers are made whole
  against slightly stale NAV and the gap socializes onto remaining holders (bounded per exit by the
  2% swap floor). **Mitigation:** the agent now measures the USDG peg live each cycle from the
  USDT0/USDG v3 pool (`pegSource`, F-2) and down-weights or vetoes the venue as it drifts, so new
  allocations stop automatically on a depeg. The owner still holds the on-chain circuit breaker: on a
  material depeg, promptly `setVenueImpaired(usdg, true)` (writes the venue down in NAV — the agent
  cannot do this) and/or `pause()`. Keep this monitor + response ready before funding.
- **After an adapter `emergencyWithdraw`.** It returns value to the pool as idle but cannot clear the
  pool's `allocated[venue]` / `totalDeployed`, so that venue keeps consuming cap headroom and a later
  `deallocate` reverts (`EmptyWithdraw`). NAV stays correct (it reads live balances). **Recovery:**
  `setVenueAllowed(venue, false)` then `removeVenue(venue)` to zero the stale principal ledger.
- **Prolonged Pendle oracle outage (G-3).** `PendlePtAdapter.balanceOf` falls open to the last good
  rate so a brief oracle hiccup never bricks `totalAssets`, but only for `maxRateStaleness` (default
  1h); past that the venue reads 0 and drops out of NAV until the oracle recovers. That auto-exclusion
  is a step change, so on an outage lasting near the bound the owner should `pause()` (blocks new
  deposits, exits still clear) to remove any deposit-then-recover arbitrage window, and
  `setVenueImpaired(pendle, true)` / `removeVenue` if the oracle is durably dead. Tune the window with
  `setMaxRateStaleness`.

## Rollback / safety

- The pool is paused until step 5; deposits/allocations are inert before then.
- Ownership is Ownable2Step, so upgrading the owner to a hardware wallet or Safe later is a clean
  `transferOwnership` + `acceptOwnership`, no redeploy.
- The agent can only allocate/deallocate within on-chain caps; the Turnkey policy bounds it further.
