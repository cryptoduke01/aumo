# Aumo threat model

Aumo holds and moves real funds. This document states what is trusted, what is not, and why a
compromised agent cannot drain the vault.

## Actors

| Actor | Trust | Can |
| --- | --- | --- |
| **Owner** | Trusted. Holds the owner key. | Fund/withdraw idle balance, set the agent, allowlist venues, set policy caps, pause. |
| **Agent** | Semi-trusted. Holds the agent key. | Allocate/deallocate **only within** the on-chain caps and allowlist. Nothing else. |
| **Venue adapter** | Trusted per-integration, reviewed before allowlisting. | Receives funds from the vault, supplies to its protocol, returns funds on withdraw. |
| **LLM reasoning layer** | Untrusted. | Propose a **more conservative** plan. Its output is re-enforced in code and cannot loosen any limit. |
| **Market data feed** | Untrusted input. | Inform scoring. Bad data can only cause a suboptimal or no-op move, never an out-of-policy one. |

## Trust boundary

Control lives in `AumoVault`, not in the agent. The vault enforces, on every `allocate`:

- venue is allowlisted (`venueAllowed`), and its `asset()` matched the vault asset at allowlist time;
- `amount <= maxMoveSize`, `amount <= idleBalance`;
- `allocated[venue] + amount <= perVenueCap`;
- `totalDeployed + amount <= maxTotalDeployed`;
- not paused.

The agent cannot withdraw to an arbitrary address — only the owner can withdraw, and only idle
funds. `deallocate` (retreat) is always available, even while paused, so the vault can always exit.

## What a compromised agent key can and cannot do

**Cannot:** withdraw funds to itself or any address, touch a non-allowlisted venue, exceed any cap,
change policy, or act while paused. The blast radius is bounded by the caps the owner set.

**Can:** within the caps, churn funds between allowlisted venues (griefing / gas waste), or move to
the least-bad allowlisted venue. Mitigations: keep `maxMoveSize` and `maxTotalDeployed` conservative,
allowlist only reviewed venues, rotate the agent key with `setAgent` (which instantly revokes the
old one), and pause on anomaly.

## Off-chain

- **Keys** never live in the repo. `agent/.env` and `contracts/.env` are gitignored; the testnet
  key is a throwaway. Execution refuses to send unless the agent key equals `agent()` on the vault.
- **Reasoning layer** failures (no network, bad JSON, timeout) fall back to the deterministic risk
  engine; they never block a retreat or force a deploy.
- **Auditability.** Each decision is written to an append-only log with the inputs, risk scores,
  rationale, transaction hashes, and a `policyFingerprint` — a hash of the exact guardrails in force.
  Changing a cap changes the fingerprint, so a decision cannot be silently attributed to a policy
  that was not actually governing it.

## Residual risks

- Adapter/venue protocol risk (e.g. an Aave incident). Bounded by `perVenueCap` and the risk band;
  the risk engine down-weights venues by curated protocol risk.
- Oracle/market-data manipulation on mainnet. Mitigated by ranking on risk-adjusted yield and by
  the on-chain caps, which cap the damage of any single bad signal.
- Owner key compromise is out of scope: the owner is the root of trust by design.
