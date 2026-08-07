# Aumo

**An autonomous treasury agent for stablecoins on X Layer.**

Deposit USDT0, set a risk band, and Aumo continuously allocates the balance into the
best risk-adjusted tokenized-RWA yield live on X Layer — rebalancing as rates and risk
change, never breaching your guardrails, and writing an onchain receipt for every move.

> Give a stablecoin a job.

Built for the BuildX AI Season Hackathon (X Layer) · AI-RWA track · submission due **Aug 21, 2026**.

---

## The loop

1. **Sense** — read live yields + risk across allowlisted venues (Chainlink Data Streams + OKX Web3 data).
2. **Decide** — rank venues by risk-adjusted yield, *inside* the policy (caps, allowlist, risk band).
3. **Act** — rebalance via the vault into the winning venue(s).
4. **Receipt** — every action emits a verifiable onchain receipt.
5. **Report** — dashboard shows the agent's reasoning, current positions, and full history.

## Why it wins (the three pillars, not the idea)

The concept isn't novel (AUREN, and copycats will pitch it too). Aumo wins on execution:

- **X Layer-native by construction** — STBL, Aave, Chainlink Data Streams, USDT0. A scored criterion, and structural (can't be faked in 2 weeks).
- **Guardrails are the headline** — spend caps, allowlisted venues, per-venue limits, kill-switch, optional human-approval. An agent you can *trust* with money.
- **Provable, not claimed** — onchain receipt per action. Show the tx, don't say "it works."

Head start: the hard part (autonomous onchain settlement, x402 payments, X Layer wiring, OKX Web3 data) is already proven in Keryx. We start at week two.

---

## 2-week MVP scope (what actually ships)

- [ ] **Vault contract** on X Layer: deposit/withdraw USDT0, allocate to 2 allowlisted venues, guardrail params (caps, risk band, pause).
- [ ] **Agent service**: the sense→decide→act loop, hard guardrail enforcement, kill-switch, receipts.
- [ ] **2 real venues**: STBL RWA-yield + Aave supply on X Layer.
- [ ] **Dashboard**: agent reasoning, positions, history, receipts.
- [ ] **Deploy**: X Layer testnet → mainnet, small real balance for the demo.
- [ ] **Submission**: dedicated X account tagging @XLayerOfficial, Google Form.

## Stack

- **Contracts:** Solidity + Foundry (minimal vault + policy).
- **Agent:** TypeScript service (viem) — reuses Keryx's settlement/agent muscle + OKX Web3 data tools.
- **Frontend:** Next.js dashboard (reuse Keryx UI patterns; sharp/editorial, not rounded).
- **Data:** Chainlink Data Streams (X Layer) + Keryx signed OKX Web3 feeds.

## Build order

1. Confirm X Layer testnet details (RPC, chainId, USDT0 test addr, Aave + STBL addresses). *(research first)*
2. Vault contract + guardrail params + Foundry tests. Deploy to testnet.
3. Agent loop against 1 venue (Aave supply) end-to-end, with receipts.
4. Add STBL venue + the rank-and-rebalance decision.
5. Dashboard (reasoning + positions + receipts).
6. Mainnet deploy + small real balance + record a demo.
7. Polish guardrails/UX, submit.

## Open risks

- Real-money autonomous agent must be bulletproof: bounded balance, allowlist-only, kill-switch, sim mode for the demo.
- Venue availability on X Layer testnet vs mainnet — verify addresses early.
- "Best-performing" 50K grant may weight TVL/usage — seed with a real deposit, don't fake volume (wash trading disqualifies).

## Not this

Not a data API (that's Keryx). Not a trading bot (we're not a trader). Not a new asset issuer.
Aumo allocates existing tokenized RWA yield, autonomously, safely, provably.
