# Aumo demo runbook

Reproducible walkthrough of the full system: the guardrailed vault, the reasoning agent, and the
real Aave path on X Layer mainnet. Every step is a command you can run.

## 0. Prerequisites

- Foundry (`forge`, `cast`) and Node ≥ 20.
- `contracts/.env` and `agent/.env` filled from their `.env.example` files. Testnet key is a
  throwaway; never use a mainnet key here.

## 1. Contracts: prove the guardrails

```bash
cd contracts
forge test                 # 26 offline tests: caps, pause, access control, agent rotation
```

Every guardrail has a test that proves it reverts: over-cap, non-allowlisted venue, non-agent
caller, zero amounts, asset mismatch, withdraw-while-deployed.

## 2. Deploy to X Layer testnet

```bash
cd contracts && set -a && source .env && set +a
forge script script/DeployTestnet.s.sol:DeployTestnet \
  --rpc-url "$XLAYER_TESTNET_RPC" --private-key "$PRIVATE_KEY" --broadcast
```

Prints the live `AumoVault`, test USDT0, and mock venue addresses. Recorded in
`contracts/deployments/xlayer-testnet.json`.

## 3. Agent: identity, reasoning, and a live move

```bash
cd agent && npm install
npm run identity     # versioned identity card: chain, vault, agent, policy, mandate
npm run plan         # sense -> score -> reason. Prints per-venue risk and a rationale. No tx.
```

Flip `EXECUTE=1` for one autonomous, on-chain move (within caps):

```bash
EXECUTE=1 npm run tick
```

The agent allocates within `maxMoveSize`, emits an on-chain receipt, and appends a full decision
record (inputs, scores, rationale, tx hash, `policyFingerprint`) to `agent/receipts/decisions.jsonl`.

## 4. Show the risk policy actually governs behaviour

```bash
RISK_APPETITE=low npm run plan
```

With a low appetite the agent refuses the moderate-risk venue and proposes a full **retreat** — the
policy drives the decision, it is not cosmetic.

## 5. Prove the real Aave X Layer mainnet path (no spend)

```bash
cd contracts
RUN_FORK=1 forge test --match-path 'test/fork/*' -vv
```

Forks X Layer mainnet, deploys the vault + Aave adapter against **live** Aave v3, supplies real
USDT0, warps 30 days so interest accrues, and retreats principal + yield to the vault.

## 6. When funding mainnet for real

```bash
cd contracts && set -a && source .env && set +a
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url "$XLAYER_MAINNET_RPC" --private-key "$PRIVATE_KEY" --broadcast
```

Then point the agent at it (`VAULT_ADDRESS`, `VENUES_FILE=mainnet`, the deployed adapter address in
`agent/config/venues.mainnet.json`) and run `npm run loop`.
