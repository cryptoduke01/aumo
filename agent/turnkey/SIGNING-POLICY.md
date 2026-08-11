# Turnkey signing policy for the Aumo agent

Goal: the agent's Turnkey key may sign **only** what the agent legitimately needs, and nothing else.
Concretely, only `allocate` / `deallocate` calls to the Aumo pool, on X Layer mainnet, with zero
native value. A leaked API key is then bounded to moves the contract already caps (it cannot sign a
transfer, an approval, a call to any other contract, or anything on another chain).

This is a **draft**. It is applied at mainnet deploy time, once the pool address exists.

## Prerequisite: the agent must be a NON-ROOT user

Turnkey **root users bypass policies**. The initial API key created with a Turnkey org is a root user,
so a policy attached to it does nothing. Before applying this policy:

1. Create a dedicated **non-root user** for the agent (or a sub-organization), with its own API key.
2. Point the agent at that key (`TURNKEY_API_PUBLIC_KEY` / `TURNKEY_API_PRIVATE_KEY`).
3. Record that user's `user_id` as `TURNKEY_AGENT_USER_ID`.

Because non-root users are **denied by default** until a policy allows them, the single ALLOW policy
below is the whole allowlist: it permits exactly the pool calls, everything else is denied.

## The policy

```json
{
  "policyName": "aumo-agent-signer-restrict-to-pool",
  "effect": "EFFECT_ALLOW",
  "consensus": "approvers.any(user, user.id == '<TURNKEY_AGENT_USER_ID>')",
  "condition": "activity.action == 'SIGN' && eth.tx.chain_id == 196 && eth.tx.to == '<AUMO_POOL>' && eth.tx.value == 0 && (eth.tx.function_signature == '0x55be7f73' || eth.tx.function_signature == '0x59db9eb0')",
  "notes": "Agent signer may only sign X Layer mainnet (196) transactions to the Aumo pool, calling allocate(address,uint256,bytes32) [0x55be7f73] or deallocate(address,uint256) [0x59db9eb0], with zero native value. Everything else is denied."
}
```

What each clause does:

- `activity.action == 'SIGN'` — this is a transaction-signing activity.
- `eth.tx.chain_id == 196` — X Layer mainnet only (no other chain).
- `eth.tx.to == '<AUMO_POOL>'` — only the Aumo pool contract.
- `eth.tx.value == 0` — never move native OKB.
- `function_signature in {0x55be7f73, 0x59db9eb0}` — only `allocate` / `deallocate`, the agent-role
  functions. Not `deposit`, `withdraw`, `setPolicy`, `setAgent`, or anything else.

Selectors verified with `cast sig`:
`allocate(address,uint256,bytes32)` = `0x55be7f73`, `deallocate(address,uint256)` = `0x59db9eb0`.

## Applying it (at deploy)

```bash
cd agent
AUMO_POOL=0x<mainnet pool> \
TURNKEY_AGENT_USER_ID=<agent user id> \
TURNKEY_BASE_URL=https://api.turnkey.com \
TURNKEY_ORGANIZATION_ID=<org id> \
TURNKEY_API_PUBLIC_KEY=<root or admin key public> \
TURNKEY_API_PRIVATE_KEY=<...> \
npx tsx scripts/turnkey-create-policy.ts
```

Note: creating a policy is itself a privileged activity, so run the create script with an admin/root
key. The agent then runs with the restricted non-root key the policy governs.

## Testnet

The policy targets mainnet (chain 196) and the mainnet pool. On testnet the agent uses the throwaway
`AGENT_PRIVATE_KEY` and no Turnkey policy is needed, so a testnet dress rehearsal is unaffected.
