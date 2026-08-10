import type { Metadata } from "next";
import { DitherMark } from "@/components/dither-mark";
import { isMainnet } from "@/lib/chain";

export const metadata: Metadata = {
  title: "Whitepaper · Aumo",
  description:
    "Aumo: an autonomous, guardrailed treasury agent for risk-adjusted stablecoin yield across lending and real-world-asset-backed venues on X Layer.",
};

export default function WhitepaperPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="relative border-b border-border/70 py-16">
        <DitherMark className="pointer-events-none absolute right-0 top-12 hidden size-40 text-foreground/[0.12] sm:block" />
        <span className="text-xs uppercase tracking-[0.14em] text-accent">
          Whitepaper · v0.4 · 2026
        </span>
        <h1 className="relative mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
          Aumo: a guardrailed treasury agent
        </h1>
        <p className="relative mt-4 text-muted-foreground">
          Autonomous, risk-adjusted stablecoin yield with custody kept on-chain.
        </p>
      </header>

      <article className="prose py-14">
        <h2>Abstract</h2>
        <p className="lead">
          Idle stablecoins are a solved problem in theory and an unsolved one in
          practice. The yield exists, but capturing it safely demands constant
          attention, disciplined risk scoring, and the trust to let something act
          on your behalf. Aumo is an autonomous agent that does the work. It scores
          venues, allocates capital, and rebalances with the market, while the
          authority to move funds is bounded by a contract rather than by good
          intentions. The agent optimises. The chain constrains.
        </p>

        <h2>1. Motivation</h2>
        <p>
          Most yield products force a choice between two bad options: hand custody
          to an opaque manager, or manage everything yourself and accept that you
          will miss regime changes, peg stress, and liquidity crunches while you
          sleep. Autonomous agents are an obvious third path, but an agent with
          unchecked authority is just a manager with worse judgement. The unlock is
          not a smarter agent. It is a smaller blast radius. If the agent can only
          ever act within limits enforced on-chain, you can let it be autonomous
          without letting it be dangerous.
        </p>

        <h2>2. Design overview</h2>
        <p>
          Depositors put USDT0 into a shared ERC-4626 pool and receive shares. An
          off-chain agent runs a five-stage loop (sense, score, reason, act, prove)
          on a schedule. It reads live venue data, computes risk-adjusted yields,
          optionally passes the plan through a tighten-only reasoning layer,
          executes the resulting move within contract caps, and writes a receipt.
          Yield accrues to the pool and therefore to every shareholder pro-rata.
        </p>

        <h2>3. Contracts</h2>
        <p>
          The pool is an ERC-4626 vault. Shares are minted on deposit and redeemed
          on withdrawal for a pro-rata claim on total assets, which sum the
          pool&apos;s idle balance and its live balances across venues. A decimals
          offset mitigates the classic first-depositor inflation attack. A separate
          single-owner vault variant exists for treasuries that do not want a
          shared pool. Both share the same guardrail design.
        </p>
        <p>
          Ownership uses a two-step transfer, and renouncement is explicitly
          disabled so the vault can never become ownerless. The pool is pausable.
          Venue approvals are reset to zero after each allocation so no standing
          allowance lingers.
        </p>

        <h2>4. Risk model</h2>
        <p>
          The engine transforms each venue&apos;s headline APY into a risk-adjusted
          figure through a transparent, weighted blend of haircuts: protocol
          maturity, liquidity-at-risk (depth measured against the size Aumo would
          actually hold), peg deviation, utilization, and a correlation-aware
          concentration penalty that treats venues moving together as closer to a
          single exposure. Each venue is assigned a band (low, moderate, elevated,
          or high) and allocation ranks on risk-adjusted APY. The weighting is
          legible by design. A depositor can read why one venue beat another.
        </p>

        <h2>5. Reasoning layer</h2>
        <p>
          On top of the deterministic engine sits an optional language-model pass
          governed by a strict safety kernel: it may only make the plan more
          conservative. It can veto a move, shrink it, or shift appetite downward
          in response to the regime it reads. It has no capability to raise a cap,
          add a venue, or increase exposure beyond what the engine already
          sanctioned. The model advises within a box it cannot open.
        </p>

        <h2>6. Execution and proofs</h2>
        <p>
          Every decision produces a receipt: the regime and appetite, the venue
          scores, the chosen move and its plain-language rationale, and a keccak
          fingerprint of the exact policy that governed it, anchored by the
          on-chain transaction hash. Because behaviour is bound to a policy
          fingerprint, any change in what the agent does is always traceable to a
          change in policy. The audit trail is the product, not an afterthought.
        </p>

        <h2>7. Cross-chain deposits</h2>
        <p>
          USDT0 is a native LayerZero OFT. Aumo quotes the real route and messaging
          fee directly from the OFT, letting depositors fund from Ethereum,
          Arbitrum, Optimism, or Polygon and arrive on X Layer ready to deposit,
          with no wrapped-asset detour.
        </p>

        <h2>8. Security and trust assumptions</h2>
        <p>
          The core assumption Aumo removes is trust in the agent&apos;s honesty. It
          cannot exceed on-chain caps and cannot withdraw to an external address,
          so a compromised or misbehaving agent cannot steal funds. The assumptions
          that remain are the venues themselves (a venue can lose money on its own
          terms), the correctness of the contracts, and the security of the owner
          key that sets policy and allowlists. Aumo is experimental and has not
          completed a formal third-party audit.
        </p>

        <h2>9. Roadmap</h2>
        <ul>
          <li>Deepen the reasoning layer with temporal awareness and scenario simulation.</li>
          <li>Expand the venue set toward genuinely composable tokenized real-world assets.</li>
          <li>Formal third-party audit ahead of a mainnet launch on X Layer.</li>
          <li>Depositor-configurable risk appetite within the contract&apos;s hard bounds.</li>
        </ul>

        <hr />

        <h2>10. Disclaimer</h2>
        <p>
          {isMainnet
            ? "This document describes software running on X Layer mainnet. It is "
            : "This document describes experimental software running on testnet. It is "}
          not an offer, solicitation, or financial advice. Yields are variable and
          not guaranteed, smart contracts carry risk, and you should never commit
          funds you cannot afford to lose. See the <a href="/terms">Terms</a> and{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </article>
    </div>
  );
}
