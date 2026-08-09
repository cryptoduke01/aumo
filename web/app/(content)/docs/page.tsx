import type { Metadata } from "next";
import { AsciiMark } from "@/components/ascii-mark";

export const metadata: Metadata = {
  title: "Docs — Aumo",
  description:
    "How Aumo works: the decision loop, the risk engine, on-chain guardrails, deposits, and bridging.",
};

const toc = [
  ["overview", "Overview"],
  ["cycle", "How it works"],
  ["architecture", "Architecture"],
  ["risk", "The risk engine"],
  ["guardrails", "Guardrails & trust"],
  ["deposit", "Deposit & withdraw"],
  ["bridge", "Bridging in"],
  ["faq", "FAQ"],
];

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      {/* header */}
      <header className="flex flex-col gap-6 border-b border-border/70 py-16 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-accent">
            Documentation
          </span>
          <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
            How Aumo works
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            A treasury agent that puts idle stablecoins to work in real-world-asset
            yield, inside limits enforced on-chain, and proves every move.
          </p>
        </div>
        <AsciiMark className="hidden shrink-0 sm:block" />
      </header>

      <div className="grid grid-cols-1 gap-12 py-14 lg:grid-cols-[200px_1fr] lg:gap-16">
        {/* toc */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 flex flex-col gap-2.5">
            <span className="mb-1 font-mono text-[10px] uppercase tracking-wider text-faint">
              On this page
            </span>
            {toc.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        {/* body */}
        <article className="prose max-w-2xl">
          <section id="overview">
            <h2>Overview</h2>
            <p className="lead">
              Aumo is an autonomous treasury agent for stablecoins. You deposit
              USDT0 into a shared pool and receive shares. An off-chain agent
              continuously scores allowlisted yield venues, allocates the pooled
              balance to the best risk-adjusted option, and records a receipt for
              every decision — all within caps written into the vault contract.
            </p>
            <p>
              The design goal is simple: the convenience of an active manager, with
              none of the custody. The agent can rebalance, but it can never move
              funds anywhere except between allowlisted venues, and never beyond the
              limits the contract enforces. Remove the agent entirely and depositor
              funds remain safe and redeemable.
            </p>
          </section>

          <section id="cycle">
            <h2>How it works</h2>
            <p>Every rebalance runs the same five steps:</p>
            <ul>
              <li><strong>Sense</strong> — read live vault state and market data for every allowlisted venue: APY, TVL, available liquidity, utilization, and peg deviation.</li>
              <li><strong>Score</strong> — the risk engine haircuts each venue&apos;s headline yield by protocol, liquidity, peg, utilization, and correlation risk, then ranks venues by <em>risk-adjusted</em> APY rather than raw APY.</li>
              <li><strong>Reason</strong> — a language-model layer reads the market regime and may only make the plan <em>more</em> conservative than the risk engine proposed. It can veto or shrink a move; it can never loosen a guardrail.</li>
              <li><strong>Act</strong> — the chosen move executes on-chain, bounded by the per-move and per-venue caps in the contract.</li>
              <li><strong>Prove</strong> — the decision is written as a receipt: a plain-language rationale bound to a keccak fingerprint of the exact policy in force, anchored by the on-chain transaction.</li>
            </ul>
          </section>

          <section id="architecture">
            <h2>Architecture</h2>
            <p>Aumo is four parts working together:</p>
            <ul>
              <li><strong>The pool</strong> — an ERC-4626 vault (<code>AumoPool</code>) that holds USDT0 and issues shares. Deposits mint shares pro-rata; withdrawals redeem them for the depositor&apos;s slice of the pool, including accrued yield. An inflation-attack mitigation (a decimals offset) protects the first depositors.</li>
              <li><strong>The agent</strong> — a TypeScript service that runs the sense → score → reason → act → record loop on a schedule and exposes a read-only status API the app reads from.</li>
              <li><strong>The reasoning layer</strong> — an optional model pass with a strict, tighten-only safety kernel: its output can only narrow the risk engine&apos;s plan.</li>
              <li><strong>The bridge</strong> — USDT0&apos;s native LayerZero OFT, so deposits can originate on Ethereum, Arbitrum, Optimism, or Polygon and arrive on X Layer ready to deposit.</li>
            </ul>
            <p>
              Everything settles on <strong>X Layer</strong>, with real yield sourced
              through Aave. The base asset is USDT0 throughout.
            </p>
          </section>

          <section id="risk">
            <h2>The risk engine</h2>
            <p>
              Headline APY is not the objective — surviving a bad day is. The engine
              converts each venue&apos;s raw yield into a risk-adjusted figure by
              applying a transparent, weighted set of haircuts:
            </p>
            <ul>
              <li><strong>Protocol risk</strong> — a base factor for the venue&apos;s maturity and audit surface.</li>
              <li><strong>Liquidity-at-risk</strong> — how much of the position could actually exit, blending market depth against the size Aumo would hold.</li>
              <li><strong>Peg deviation</strong> — how far the underlying has drifted from par.</li>
              <li><strong>Utilization</strong> — how stretched the venue is, which governs whether an exit is even available.</li>
              <li><strong>Correlation-aware concentration</strong> — exposure is penalised not per-venue in isolation but by how correlated the venues are, so two names that move together are treated closer to one.</li>
            </ul>
            <p>
              Each venue lands in a band — <strong>low</strong>, <strong>moderate</strong>,
              <strong> elevated</strong>, or <strong>high</strong> — and the engine ranks on
              risk-adjusted APY. The full breakdown for the latest cycle is visible in
              the app.
            </p>
          </section>

          <section id="guardrails">
            <h2>Guardrails &amp; trust</h2>
            <p>
              Because Aumo moves real money, the limits live in the contract, not in
              the agent&apos;s code:
            </p>
            <ul>
              <li><strong>Per-move cap</strong> — the most that can move in a single transaction.</li>
              <li><strong>Per-venue cap</strong> — the most that can sit in any one venue.</li>
              <li><strong>Max total deployed</strong> — the ceiling on how much of the pool is ever at work.</li>
              <li><strong>Allowlisted venues only</strong> — the agent can send funds nowhere else.</li>
              <li><strong>No external withdrawal path</strong> — the agent can shuffle funds between allowlisted venues and back to the pool. It cannot withdraw to any outside address.</li>
            </ul>
            <p>
              Ownership uses a two-step transfer and renouncing is disabled, so the
              vault can never be left ownerless. The pool can be paused. Every
              decision is bound to a fingerprint of the governing policy, so a change
              in behaviour is always traceable to a change in policy.
            </p>
          </section>

          <section id="deposit">
            <h2>Deposit &amp; withdraw</h2>
            <p>
              Deposit USDT0 into the pool and receive ERC-4626 shares — your claim on
              a pro-rata slice of everything the agent earns. The first deposit needs a
              one-time approval so the pool can pull your USDT0, then the deposit
              itself. Withdraw at any time by redeeming shares for USDT0 at the current
              share price.
            </p>
            <p>
              Aumo is currently on X Layer testnet. You&apos;ll need testnet USDT0 and a
              little OKB for gas.
            </p>
          </section>

          <section id="bridge">
            <h2>Bridging in</h2>
            <p>
              USDT0 is a LayerZero OFT, so you can fund your position from another
              chain. Pick a source chain and amount and Aumo quotes the real route and
              messaging fee from the OFT. The bridged USDT0 arrives on X Layer ready to
              deposit. On testnet the flow previews the genuine route and fee.
            </p>
          </section>

          <section id="faq">
            <h2>FAQ</h2>
            <h3>Can the agent run off with my funds?</h3>
            <p>
              No. It can only move funds between allowlisted venues and back to the
              pool, within on-chain caps. There is no code path that sends funds to an
              arbitrary address.
            </p>
            <h3>What happens if the agent goes offline?</h3>
            <p>
              Nothing to your funds. Deposits and withdrawals are contract functions
              that work whether or not the agent is running. An offline agent simply
              stops rebalancing.
            </p>
            <h3>Is this audited?</h3>
            <p>
              Aumo is experimental software on testnet. The contracts have been
              hardened and internally reviewed, but they have not completed a formal
              third-party audit. Do not deposit funds you cannot afford to lose.
            </p>
            <h3>Is this financial advice?</h3>
            <p>
              No. Aumo is a tool. Yields are variable and not guaranteed. See the{" "}
              <a href="/terms">Terms</a>.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
