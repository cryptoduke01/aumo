# Aumo mainnet deploy runbook

Not a deploy trigger. This records the finalized config and the exact steps, so the actual launch is
mechanical when we decide to go. X Layer mainnet, chainId 196, RPC `https://rpc.xlayer.tech`.

## Roles (public addresses)

| Role | Address | Notes |
|---|---|---|
| **Owner** (crown jewel) | `0x9471A4ea01f51d01749D9E9696b973faf27a96AE` | fresh dedicated cold EOA; seed saved offline; used for owner actions only. Upgrade to hardware/Safe later via `transferOwnership` (Ownable2Step). |
| **Agent signer** | `0x2647904345d00Ef30d831935b913E5df1D58af67` | Turnkey-held key (org `b072be8b-…`, wallet `57537868-…`). Restricted by the signing policy to allocate/deallocate on the pool. Live-proven on testnet. |
| Asset (USDT0) | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | canonical X Layer USDT0 |

Venue adapter targets (Aave v3, USDG, Uniswap SwapRouter02) are hardcoded and fork-verified in
`script/DeployPoolMainnet.s.sol` / the adapters.

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

## Rollback / safety

- The pool is paused until step 5; deposits/allocations are inert before then.
- Ownership is Ownable2Step, so upgrading the owner to a hardware wallet or Safe later is a clean
  `transferOwnership` + `acceptOwnership`, no redeploy.
- The agent can only allocate/deallocate within on-chain caps; the Turnkey policy bounds it further.
