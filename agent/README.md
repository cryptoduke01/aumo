# Aumo agent

The reasoning brain and risk engine that allocates the vault within its on-chain guardrails.

Each cycle the agent runs five stages:

1. **Sense** — read the live vault (idle, deployed, caps, allowlist, positions) and join it with venue market data.
2. **Score** — the risk engine decomposes each venue into protocol, liquidity, peg, utilization, and concentration risk, blends them into one score and band, and haircuts APY into a risk-adjusted yield. It does not chase APY.
3. **Reason** — an optional LLM layer reads the regime and may only *tighten* the plan (go more defensive, veto a venue). It never loosens a limit or adds a venue; the result is re-enforced in code.
4. **Act** — moves are sent as `allocate` / `deallocate` calls, each inside the contract's hard caps. The vault re-checks every guardrail, so the worst a bug can do is revert.
5. **Record** — every tick appends an audit record: the inputs seen, the scores, the rationale, and the transaction hashes. The chain holds the receipts; this holds the reasoning.

## Run

```bash
npm install
cp .env.example .env   # fill in RPC_URL, VAULT_ADDRESS, AGENT_PRIVATE_KEY (testnet throwaway)
npm run plan           # dry-run: sense, score, reason — never sends a transaction
npm run tick           # one cycle; sends only if EXECUTE=1 and the key is the vault agent
npm run loop           # repeat every LOOP_INTERVAL_SECONDS
```

The LLM layer is optional. Without `ANTHROPIC_API_KEY` the agent runs on the deterministic risk engine alone and still produces a full plan and rationale.

## Safety

- The agent holds only the `agent` role. It cannot withdraw funds, change policy, or touch a non-allowlisted venue — those are owner-only on the contract.
- `EXECUTE=0` (default) is a dry-run. `EXECUTE=1` sends transactions, and the agent refuses to send unless its key matches `agent()` on the vault.
- Never put a mainnet key in `.env`. The testnet key is a throwaway.
