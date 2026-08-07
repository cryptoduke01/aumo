---
phase: idea
completed_at: 2026-08-03T00:00:00Z
---

# Idea Context — Aumo

## chosen_idea
- **slug:** aumo-autonomous-rwa-treasury-agent
- **name:** Aumo
- **one_liner:** An autonomous treasury agent for stablecoins on X Layer — deposit USDT0, set a risk band, and it allocates into the best risk-adjusted tokenized-RWA yield, guardrail-first, with an onchain receipt for every move.
- **why_crypto:** The yield is tokenized onchain (STBL, Aave-RWA); allocation + settlement are trustless, programmable, and produce verifiable receipts. Remove the chain and there's no tokenized RWA to allocate into and no autonomous settlement.

## scores (1-3)
- founder_fit: 3 (already owns the OKX x402 / X Layer / agent-settlement stack via Keryx)
- mvp_speed: 2 (autonomous real-money agent adds safety scope)
- market_pull: 3 (RWA + AI both hot; OKX's own hackathon rewards X Layer integration)
- rubric_fit: 3
- differentiation: 3 (X Layer-native + guardrails + provable receipts)

## competitors
- AUREN (autonomous capital for RWA; brands its agents "Stewards") — not X Layer-native.
- IXS RWA agent, Ant Group Anvita, Theoriq Alpha Vault ($25M TVL) — validated space, none X Layer-native.

## mvp_checklist
- Vault contract (deposit/withdraw USDT0, allocate to 2 allowlisted venues, guardrail params) on X Layer testnet→mainnet
- Agent loop: sense (Chainlink Data Streams + Keryx data) → decide (rank within policy) → act (rebalance) → receipt → report
- Guardrails: caps, allowlist, per-venue limits, kill-switch, optional human-approval
- 2 venues: STBL RWA-yield + Aave supply on X Layer
- Dashboard (reasoning, positions, receipts)
- Dedicated X account tagging @XLayerOfficial; Google Form submission

## gtm
- wedge: X Layer builders + agent/treasury holders who want yield on idle USDT0 without babysitting it
- proof: seed a real deposit, show onchain receipts and the agent's reasoning
- channels: BuildX builder TG, X (@aumo_fi / @useaumo), Bunsan/@XLayerOfficial tag

## source_reports
- keryx/idea-shortlist-buildx-airwa.html

## context
- Hackathon: BuildX AI Season (X Layer), Aug 7-21 2026, AI-RWA track. Targets: fixed 30/15/5K + AI-RWA 50K liquidity grant. 200K launch grant = upside only (needs 10M real DEX volume; wash trading disqualifies).
- Builder: solo dev, "a dev not a trader," shipped Keryx (live pay-per-call ASP on OKX.AI, x402/USDT0 on X Layer mainnet).
- Stack: Foundry (Solidity vault) + TS agent (viem, reuse Keryx) + Next.js dashboard.
- Name: Aumo (verified clean in crypto; backup Volen). Domain: aumo.fi / aumo.xyz / aumo.trade (user to purchase). Handle: grab @aumo_fi / @useaumo now.
