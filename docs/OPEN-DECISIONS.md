# Open design decisions

Decisions that change the core and deserve an explicit call rather than a silent build.

## 1. Single-owner treasury vs multi-depositor vault

Today `AumoVault` is a **single-owner treasury**: the owner funds it, the agent allocates within
caps, only the owner withdraws. It is small, proven, and tested — the trust core.

"Users can deposit" implies **many depositors**. That is a different contract: a shares vault
(ERC-4626-style) where anyone deposits, receives shares, and redeems their pro-rata value while the
agent manages the pooled balance. It is the right product shape for a public deposit flow, but it is
a real build with its own risks (share accounting, first-depositor inflation attack, withdrawal
liveness while funds are deployed, per-depositor accounting).

**Recommendation:** build it as a **new** contract (`AumoPool`, ERC-4626) alongside the proven
single-owner vault, fully tested and reviewed, rather than mutating the deployed trust core. Keep the
agent + risk engine unchanged; they operate on either.

**Decision needed:** ship the multi-depositor pool now, or keep single-owner for the hackathon demo
and treat multi-user as fast-follow?

## 2. Auto-deposit on bridge arrival

The bridge lands USDT0 on X Layer at the recipient. Fully automatic *deposit-on-arrival* (funds
bridge in and land inside the vault in one motion) needs a small on-chain **composer** that
implements LayerZero's `lzCompose`, receives the bridged USDT0, and deposits it.

This depends on decision #1: for a single-owner vault the composer deposits on the owner's behalf;
for a shares vault it mints shares to the original depositor across the bridge (the composer must
carry the depositor identity in the compose message).

**Decision needed:** wire auto-deposit-on-arrival (requires the composer), or keep the two steps
explicit (bridge, then deposit) for now?

## 3. Live mainnet market feed

On testnet the agent reads venue metrics from a static config. On mainnet those should be live reads
(Aave reserve data / rates, oracle prices) so the risk engine scores real conditions. Straightforward
but real work; slot it before the mainnet demo.
