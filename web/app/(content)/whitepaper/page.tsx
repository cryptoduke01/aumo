import type { Metadata } from "next";
import { DitherMark } from "@/components/dither-mark";
import { isMainnet } from "@/lib/chain";

export const metadata: Metadata = {
  title: "Whitepaper · Aumo",
  description:
    "Aumo: an autonomous, guardrailed treasury agent for risk-adjusted stablecoin yield across lending and real-world-asset-backed venues on X Layer, with opt-in pools for tokenized US stocks, a diversified basket, and tokenized gold.",
};

export default function WhitepaperPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="relative border-b border-border/70 py-16">
        <DitherMark className="pointer-events-none absolute right-0 top-12 hidden size-40 text-foreground/[0.12] sm:block" />
        <span className="text-xs uppercase tracking-[0.14em] text-accent">
          Whitepaper · v0.6 · 2026
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
          intentions. The agent optimises. The chain constrains. The same design now
          extends beyond the safe stablecoin pool into opt-in, at-risk pools for
          tokenized US stocks, a diversified basket, and tokenized gold, each in its own
          isolated pool under the identical guardrails (Section 9).
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
        <p>
          Capital reaches yield through venue adapters, one per market, each
          fork-tested against its live counterpart on X Layer mainnet: Aave v3
          lending; USDG supplied to Aave for RWA-backed yield; Pendle PT-USDG fixed
          yield to maturity; and a full-range USDG/USDT0 position on Uniswap v3 that
          earns trading fees on two dollar-pegged legs. Beyond the per-move,
          per-venue, and total-deployed caps, two rolling per-epoch budgets bound the
          agent further: a loss budget caps the value it can destroy through swap
          spreads in a window, and a deploy budget rate-limits how fast it can stage
          new capital. Both meter the entry swap and the exit round trip alike.
          Depositor withdrawals are never subject to either, so redemptions always
          clear.
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
        <p>
          Because the safety is a property of the kernel and not of any one model, the
          reasoning pass is provider-pluggable. The same tighten-only layer, the
          specialist panel it convenes, and the Ask Aumo endpoint run on Groq
          (OpenAI-compatible) or Anthropic, selected by configuration. Swapping the
          provider changes only how conservatively a plan may be tightened, never
          whether it can be loosened, because the contract re-checks every guardrail
          after the model answers regardless of which model that was.
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
          key that sets policy and allowlists. The real-world-asset pools (Section 9)
          add two disclosed assumptions of the same class: a self-hosted price oracle
          whose feeder key is the source of truth until it is migrated to a network
          feed, and the freeze and pause powers the token issuers (Paxos and the
          xStock issuers) retain over the underlying. Aumo is experimental and has not
          completed a formal third-party audit.
        </p>

        <h2>9. Real-world-asset pools</h2>
        <p>
          Alongside the safe stablecoin pool, Aumo runs opt-in pools for tokenized US
          stocks, a diversified basket, and tokenized gold. Each is a separate isolated
          ERC-4626 pool that takes USDT0. These pools deliberately hold directional
          price exposure the depositor chose, so they are not capital preservation and
          their share value moves with the underlying. They reuse the safe pool&apos;s
          whole trust model unchanged (the owner sets policy, an allowlisted agent moves
          funds only within hard caps, and the owner never has custody) and add three
          equity-specific behaviours: US market hours enforced by the contract on both
          entry and exit, so no one transacts at a stale price; an oracle-derived
          minimum out on every swap, so a manipulated pool reverts rather than filling
          far from fair value; and redemption at realizable value.
        </p>
        <p>
          Four isolated pools track NVIDIA, Apple, Microsoft, and Meta. Each routes
          USDT0 to the wrapped xStock through Uniswap v3, priced by an on-chain equity
          oracle Aumo operates and discloses. On a single-stock pool the agent buys and
          holds the exposure the depositor chose. It does not time the market. A fifth
          pool holds all four equal-weight through four adapters, and the agent&apos;s
          only job is to keep the weights equal by rebalancing on drift within a band.
          The basket exists because diversification is the one thing that reliably
          reduced drawdown in a five-year backtest, while a trend-timing overlay we
          tested on single names whipsawed and did not reliably help, so we removed it.
          The figures and method are in the <a href="/research">research note</a>.
        </p>
        <p>
          A separate opt-in pool holds PAXGy, Paxos&apos; yield-bearing tokenized gold.
          It tracks the gold price, and its gold entitlement grows over time, so a
          holder earns a yield denominated in gold on top of the price exposure. Aumo
          prices it from PAXGy&apos;s on-chain gold rate combined with a gold price feed
          it runs, and routes USDT0 through USDG to PAXGy on Uniswap v3. Gold moves in
          dollar terms, so this too is not capital preservation.
        </p>
        <p>
          The equity and gold oracle is self-hosted for now: a feeder Aumo runs posts
          prices through a single trusted key, disclosed to depositors, with the
          consumer contracts reading through an oracle-agnostic interface so a later
          move to a verified network feed is a single owner call and no depositor
          action. Before these pools opened to deposits, a multi-agent internal security
          pass proved two Medium-severity issues with fork proof-of-concepts
          (exit-slippage socialization and a NAV-latency skim) and fixed both with a
          tighter oracle staleness window and an anti-dilution levy retained by the pool
          (25 basis points on entry, 50 on exit), so a joiner or leaver bears the value
          their own action moves rather than the holders who stay. The levy is capped in
          the contract so it can never become a fee. The hardened pools were redeployed
          to X Layer mainnet before accepting deposits.
        </p>

        <h2>10. Roadmap</h2>
        <ul>
          <li>Deepen the reasoning layer with temporal awareness and scenario simulation.</li>
          <li>Migrate the self-hosted equity and gold oracle to a verified network feed through the oracle-agnostic interface, with no depositor action required.</li>
          <li>Broaden the real-world-asset surface. The tokenized-stock pools, the diversified basket, and the tokenized-gold pool are live on X Layer mainnet; further names and asset classes follow as their on-chain liquidity supports it.</li>
          <li>Formal third-party audit of the deployed contracts. Mainnet went live on X Layer on August 13, 2026, starting from a deliberately small pool under conservative caps that widen as the audit and on-chain track record mature; the equity pools were opened only after an internal security pass and a hardened redeploy.</li>
          <li>Depositor-configurable risk appetite within the contract&apos;s hard bounds.</li>
        </ul>

        <hr />

        <h2>11. Disclaimer</h2>
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
