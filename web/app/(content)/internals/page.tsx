import type { Metadata } from "next";
import { DitherMark } from "@/components/dither-mark";

export const metadata: Metadata = {
  title: "Internals · Aumo",
  description:
    "How Aumo works in depth: the ERC-4626 pool, on-chain guardrails, the risk engine math, the planner, the venue adapters, and the proof layer.",
};

export default function InternalsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="relative border-b border-border/70 py-16">
        <DitherMark className="pointer-events-none absolute right-0 top-12 hidden size-40 text-foreground/[0.12] sm:block" />
        <span className="text-xs uppercase tracking-[0.14em] text-accent">Internals · Technical reference</span>
        <h1 className="relative mt-3 text-4xl font-medium tracking-tight sm:text-5xl">How Aumo works, in depth</h1>
        <p className="relative mt-4 text-muted-foreground">
          The architecture, the risk math, and the exact mechanics behind every on-chain move. For the
          technically inclined. Everything here maps to code you can read and transactions you can verify.
        </p>
      </header>

      <article className="prose py-14">
        <h2>1. Architecture</h2>
        <p>
          Aumo is four parts with a hard separation of powers. The <strong>pool</strong> holds the money
          and enforces policy on-chain. The <strong>agent</strong> reasons off-chain and can only ever
          call two functions on the pool. The <strong>adapters</strong> are the venue plumbing. The{" "}
          <strong>proof layer</strong> records every decision. The agent never has custody: it holds one
          role that can move funds only between allowlisted venues and back, never to an outside address.
        </p>
        <ul>
          <li><strong>Pool</strong> (Solidity, ERC-4626): custody, share accounting, and every guardrail.</li>
          <li><strong>Agent</strong> (TypeScript, viem): sense, score, reason, critic, act, prove.</li>
          <li><strong>Adapters</strong>: one per venue, translating deposit/withdraw into the venue&apos;s calls.</li>
          <li><strong>Proof</strong>: an append-only receipt per cycle, each stamped with a policy fingerprint.</li>
        </ul>

        <h2>2. The pool (ERC-4626)</h2>
        <p>
          Depositors put in USDT0 and receive <code>aumoUSDT0</code> shares. Shares are minted pro-rata
          and redeemed for a claim on total assets, so yield accrues to the share price, not to a separate
          balance. Total assets are computed live:
        </p>
        <p><code>totalAssets = idle USDT0 in the pool + Σ (each venue&apos;s live balance)</code></p>
        <p>
          A venue&apos;s live balance is read from its adapter&apos;s <code>balanceOf</code>, which reflects
          principal plus accrued yield (or minus a realized loss). Each read is wrapped in a try/catch, so a
          single venue whose view reverts contributes zero rather than bricking the whole valuation.
        </p>
        <p>
          <strong>First-depositor inflation is neutralized</strong> with a decimals offset of 6 (OpenZeppelin&apos;s
          virtual-shares approach): the attacker who donates to inflate the share price cannot round the next
          depositor to zero, because the virtual offset dominates the donation at these sizes. Ownership uses a
          two-step transfer and renouncement is disabled, so the pool can never be left ownerless. The pool is
          pausable; redemptions are never pausable, so depositors can always exit.
        </p>
        <p>
          <strong>Redemption waterfall.</strong> On withdraw, if idle does not cover the request, the pool
          pulls from venues in repeated passes (bounded by venue-count plus two), sizing each pull to just
          what is needed so a small redemption never force-liquidates a whole position through a lossy swap.
          A venue whose withdraw reverts is skipped, not fatal, so one bad venue never blocks an exit.
        </p>

        <h2>3. On-chain guardrails</h2>
        <p>The agent optimizes; the contract constrains. Every limit below is enforced in the pool, not in the agent&apos;s code:</p>
        <ul>
          <li><strong>Per-move cap</strong> (<code>maxMoveSize</code>): the most that can move in one transaction.</li>
          <li><strong>Per-venue cap</strong> (<code>perVenueCap</code>): the most exposure to any single venue.</li>
          <li><strong>Total-deployed cap</strong> (<code>maxTotalDeployed</code>): the ceiling on capital at work.</li>
          <li><strong>Allowlist</strong>: funds can only reach an allowlisted venue, never an arbitrary address.</li>
        </ul>
        <p>
          Caps are checked against <em>real exposure</em>, defined as <code>max(principal, live balance)</code>,
          so a venue that has accrued above its booked principal cannot be topped up past the cap through the
          accounting seam. Two rolling per-epoch budgets bound the agent further:
        </p>
        <ul>
          <li>
            <strong>Loss budget</strong> (<code>maxEpochLoss</code> per <code>lossEpochLength</code>): the total
            realized value the agent can destroy through swap spreads in a window. Both legs are metered: the
            entry swap in <code>allocate</code> charges <code>amount − supplied</code>, and the exit round trip
            in an agent-driven <code>deallocate</code> charges <code>pulledPrincipal − returned</code>. Once the
            window&apos;s budget is spent, further lossy moves revert. Depositor withdrawals are never metered,
            so redemptions always clear.
          </li>
          <li>
            <strong>Deploy budget</strong> (<code>maxEpochDeploy</code> per <code>deployEpochLength</code>): a
            rate limit on how fast fresh capital can be staged, bounding churn independently of the loss budget.
          </li>
        </ul>

        <h2>4. The decision loop</h2>
        <p>Each cycle runs six stages. The last three can only ever make the plan safer than the risk engine proposed.</p>
        <ol>
          <li><strong>Sense</strong>: read live pool state (idle, caps, allowlist, positions) and join it with each venue&apos;s market data.</li>
          <li><strong>Score</strong>: the deterministic risk engine turns headline APY into risk-adjusted yield (below).</li>
          <li><strong>Reason</strong>: an optional LLM pass under a tighten-only safety kernel. It can veto or go more defensive; it can never raise a cap, add a venue, or increase exposure.</li>
          <li><strong>Critic</strong>: an adversarial final gate that rejects self-contradictory or over-sized plans.</li>
          <li><strong>Act</strong>: the surviving moves are sent as <code>allocate</code> / <code>deallocate</code> calls, nonce-sequenced within the cycle.</li>
          <li><strong>Prove</strong>: the inputs, scores, rationale, and transaction hashes are written to the receipt trail.</li>
        </ol>

        <h2>5. The risk engine</h2>
        <p>
          Headline APY is never the objective. Each venue is decomposed into bounded sub-scores in{" "}
          <code>[0, 1]</code>, blended by fixed weights, mapped to a band, and used to haircut the APY. Every
          number is legible and appears in the receipt.
        </p>
        <p><strong>Weighted blend</strong> (weights sum to 1):</p>
        <p>
          <code>
            level = 0.30·protocol + 0.25·liquidity + 0.20·peg + 0.15·utilization + 0.10·concentration
          </code>
        </p>
        <ul>
          <li><strong>Protocol</strong>: a curated base factor for the venue&apos;s maturity and audit surface.</li>
          <li>
            <strong>Liquidity</strong>: <code>0.6·depthRisk + 0.4·exitRisk</code>, where depthRisk is one minus
            withdrawable/TVL, and exitRisk is our position over what can be withdrawn now. It blends the
            venue&apos;s own depth with whether <em>we</em> can get out.
          </li>
          <li>
            <strong>Peg</strong>: deviation from par, saturating at 150bps for RWA venues. Fail-conservative:
            an RWA venue whose peg was not verified from a live TWAP this cycle is floored at 0.5, so an
            unmonitored peg never reads as a perfect peg.
          </li>
          <li><strong>Utilization</strong>: lending only, rising once utilization passes 80%.</li>
          <li>
            <strong>Concentration</strong>: correlation-aware. Exposure to a venue counts fully against itself
            and partially against everything correlated with it (same-kind correlation 0.75, cross-kind 0.20),
            so diversifying across uncorrelated venues genuinely lowers risk while splitting across correlated
            ones does not.
          </li>
        </ul>
        <p>
          <strong>Momentum</strong> adds a bounded trend penalty (up to 0.15) so a venue deteriorating over
          recent cycles scores riskier than its level alone. <strong>Two RWA-specific gates</strong> then apply:
          a <em>data-staleness</em> penalty (+0.25) when a venue&apos;s live feed failed this cycle, and a{" "}
          <em>redemption-gate</em> penalty (+0.30) when exit is impaired (a lending reserve utilized past 98%,
          or our position exceeding withdrawable depth). The final score, clamped to <code>[0, 1]</code>:
        </p>
        <p>
          <code>
            risk = clamp(level + 0.15·momentum + 0.25·[stale] + 0.30·[gated])
          </code>
        </p>
        <p>
          Bands: low below 0.25, moderate below 0.5, elevated below 0.75, else high. Risk-adjusted yield is{" "}
          <code>apyBps · (1 − risk)</code>, and the allocator ranks on that, never on raw APY. A gated or stale
          venue is hard-blocked from receiving fresh capital regardless of its score.
        </p>

        <h2>6. The planner</h2>
        <p>The planner runs three steps in order, so risk is always reduced before any is added:</p>
        <ol>
          <li>
            <strong>Retreat</strong>: unwind any held venue that is no longer allowlisted, has crossed the risk
            band, or has breached the hard peg-break threshold. A fast depeg is met with an immediate exit.
          </li>
          <li>
            <strong>Deploy idle</strong>: place idle capital into the best risk-adjusted venues, sized to the
            per-move cap, the concentration cap, and a share of the venue&apos;s exit liquidity, skipping any
            gated or stale venue.
          </li>
          <li>
            <strong>Rotate</strong>: move capital from the weakest held venue into a better one, but only when
            the edge clears a threshold and can pay for itself. The gate:
          </li>
        </ol>
        <p>
          A rotation fires only if the risk-adjusted edge exceeds ~200bps <em>and</em> the realizable portion of
          that edge, over the remaining horizon, beats the ~100bps round-trip swap cost. For a fixed-maturity
          venue like a Pendle PT, only the yield capturable before maturity counts, so a large headline edge on
          a position maturing soon correctly does not justify a rotation. This is why the agent often holds: not
          idleness, but the round-trip cost or the concentration cap making the move a net loss. Rotations
          execute as atomic pairs (the funding out-leg must confirm before its in-leg fires), and the on-chain
          loss budget hard-caps the realized cost of churn.
        </p>

        <h2>7. Venue adapters</h2>
        <p>
          Every adapter honors one interface (<code>deposit</code>, <code>withdraw</code>, <code>balanceOf</code>,{" "}
          <code>asset</code>) and is fork-tested against its live counterpart on X Layer mainnet. The pool books
          the <em>net value actually placed</em> (the delta), not the gross input, so principal tracks NAV.
        </p>
        <h3>Aave v3</h3>
        <p>Supplies USDT0 and holds the interest-bearing aToken. Value is the aToken balance, 1:1 with the asset.</p>
        <h3>USDG (RWA-backed)</h3>
        <p>
          Swaps USDT0 to USDG on Uniswap behind a non-zero slippage floor (a thin or manipulated swap reverts
          rather than bleeding value), then supplies USDG to Aave for real-world-asset yield. Valued at the
          aUSDG balance with a small NAV discount for the marginal round-trip cost.
        </p>
        <h3>Pendle PT-USDG</h3>
        <p>
          Buys the Principal Token for fixed yield to maturity. NAV is read from a TWAP oracle
          (<code>getPtToAssetRate</code>), never a spot read, and clamped at par (a PT is worth at most its face
          value before maturity). The read fails open with a staleness bound, and the market&apos;s oracle
          cardinality must be provisioned before allocation so the TWAP window is available.
        </p>
        <h3>USDG/USDT0 LP (Uniswap v3)</h3>
        <p>
          The liquidity-provision venue. On deposit it swaps half the USDT0 to USDG and mints full-range
          liquidity (tick bounds ±887272, so the position is always in range and never needs rebalancing) via
          the pool&apos;s mint callback. It earns the pool&apos;s 0.01% trading fee pro-rata; fees accrue on the
          position as owed tokens and are collected on unwind, compounding into NAV rather than a separate claim.
        </p>
        <p>
          Position valuation vendors Uniswap&apos;s own <code>LiquidityAmounts</code> and 512-bit{" "}
          <code>FullMath.mulDiv</code> exactly, so it matches the pool&apos;s math with no approximation, and it
          reads the sqrt price through a <strong>peg-band clamp</strong> (bounded to ±1% of the 1:1 peg) rather
          than raw spot, so a manipulated or depegged spot cannot inflate NAV. Withdrawals honor the requested
          amount by burning a proportional slice and leaving the rest live. The live fee APY is measured from
          the growth of the pool&apos;s <code>feeGrowthGlobal</code> between readings: for a full-range position
          the yield over a period is
        </p>
        <p><code>(ΔfeeGrowth0 + ΔfeeGrowth1) / 2^129</code></p>
        <p>
          annualized by the elapsed time, computed in full-precision integer math and clamped to a sane ceiling,
          because the liquidity and decimal scales cancel for a full-range mint valued near the peg.
        </p>

        <h2>8. Proof and attribution</h2>
        <p>
          Every cycle appends a receipt: the market it saw, the risk scores, the plan and its rationale, the
          execution results with transaction hashes, and a keccak <strong>policy fingerprint</strong> of the
          exact caps and budgets in force. Because each decision is bound to a fingerprint, any change in the
          agent&apos;s behavior is always traceable to a change in policy.
        </p>
        <p>
          Realized performance is measured honestly, as the growth of the vault&apos;s price per share:
        </p>
        <p><code>pricePerShare = totalAssets / totalSupply</code></p>
        <p>
          Idle capital keeps this flat; the agent&apos;s job is to grow it, net of every swap and move. A fresh
          deposit briefly dips price per share by the one-time swap cost of deploying it, which is recovered as
          yield accrues, so the realized figure is only reported once a fair window has elapsed and is never
          annualized from a window too short to mean anything. The full trail is exportable as CSV.
        </p>

        <h2>9. Signing and cross-chain</h2>
        <p>
          On mainnet the agent&apos;s key is sealed in a Turnkey TEE with a policy that permits only{" "}
          <code>allocate</code> / <code>deallocate</code> on the pool, never a transfer out and never a deposit,
          so the signer cannot self-deal even if compromised. Deposits can originate on Ethereum, Arbitrum,
          Optimism, or Polygon and arrive on X Layer through USDT0&apos;s native LayerZero OFT, with the route
          and messaging fee quoted from the OFT itself, no wrapped-asset detour.
        </p>

        <h2>10. Security posture</h2>
        <p>
          The pool and adapters are covered by an offline unit suite plus a stateful invariant suite (share
          backing, cap ceilings, and claims-within-assets hold across thousands of randomized calls), and every
          adapter is fork-proven end to end against live X Layer contracts. New money-code goes through a
          multi-pass adversarial review (math, economic, and access-control lenses) before it is allowlisted.
          The core assumption Aumo removes is trust in the agent&apos;s honesty: it cannot exceed on-chain caps
          and cannot withdraw to an external address, so a compromised agent cannot steal funds. The assumptions
          that remain are the venues themselves, the correctness of the contracts, and the owner key that sets
          policy. Aumo is experimental and has not completed a formal third-party audit.
        </p>
      </article>
    </div>
  );
}
