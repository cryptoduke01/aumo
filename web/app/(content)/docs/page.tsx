import type { Metadata } from "next";
import { AsciiMark } from "@/components/ascii-mark";
import { isMainnet } from "@/lib/chain";

export const metadata: Metadata = {
  title: "Docs · Aumo",
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
      <header className="flex flex-col gap-6 border-b border-border/70 py-16 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="text-xs uppercase tracking-[0.14em] text-accent">
            Documentation
          </span>
          <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
            How Aumo works
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            A treasury agent that puts idle stablecoins to work in
            the best risk-adjusted yield across on-chain lending and
            real-world-asset-backed dollars, inside limits enforced on-chain, and
            proves every move.
          </p>
        </div>
        <AsciiMark className="hidden shrink-0 sm:block" />
      </header>

      <div className="grid grid-cols-1 gap-12 py-14 lg:grid-cols-[200px_1fr] lg:gap-16">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 flex flex-col gap-2.5">
            <span className="mb-1 text-[10px] uppercase tracking-wider text-faint">
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

        <article className="prose max-w-2xl">
          <section id="overview">
            <h2>Overview</h2>
            <p className="lead">
              Aumo is an autonomous treasury agent for stablecoins. You deposit
              USDT0 into a shared pool and receive shares. An off-chain agent
              continuously scores allowlisted yield venues, allocates the pooled
              balance to the best risk-adjusted option, and records a receipt for
              every decision. All of this happens within caps written into the
              vault contract.
            </p>
            <p>
              The goal is to give the convenience of an active manager without the
              custody. The agent can rebalance, but it can only move funds between
              allowlisted venues, and never beyond the limits the contract
              enforces. If you remove the agent, depositor funds stay safe and
              redeemable.
            </p>
          </section>

          <section id="cycle">
            <h2>How it works</h2>
            <p>Every rebalance runs the same five steps.</p>
            <ul>
              <li><strong>Sense.</strong> Read live vault state and market data for every allowlisted venue: APY, TVL, available liquidity, utilization, and peg deviation.</li>
              <li><strong>Score.</strong> The risk engine haircuts each venue&apos;s headline yield by protocol, liquidity, peg, utilization, and correlation risk, then ranks venues by risk-adjusted APY rather than raw APY.</li>
              <li><strong>Reason.</strong> A language-model layer reads the market regime. It can only make the plan more conservative than the risk engine proposed. It can veto or shrink a move. It cannot loosen a guardrail.</li>
              <li><strong>Act.</strong> The chosen move executes on-chain, bounded by the per-move and per-venue caps in the contract.</li>
              <li><strong>Prove.</strong> The decision is written as a receipt: a plain-language rationale bound to a keccak fingerprint of the exact policy in force, anchored by the on-chain transaction.</li>
            </ul>
          </section>

          <section id="architecture">
            <h2>Architecture</h2>
            <p>Aumo has four parts working together.</p>
            <ul>
              <li><strong>The pool.</strong> An ERC-4626 vault (<code>AumoPool</code>) that holds USDT0 and issues shares. Deposits mint shares pro-rata. Withdrawals redeem them for the depositor&apos;s slice of the pool, including accrued yield. A decimals offset mitigates the first-depositor inflation attack.</li>
              <li><strong>The agent.</strong> A TypeScript service that runs the sense, score, reason, act, record loop on a schedule and exposes a read-only status API the app reads from.</li>
              <li><strong>The reasoning layer.</strong> An optional model pass with a strict, tighten-only safety kernel. Its output can only narrow the risk engine&apos;s plan.</li>
              <li><strong>The bridge.</strong> USDT0&apos;s native LayerZero OFT, so deposits can originate on Ethereum, Arbitrum, Optimism, or Polygon and arrive on X Layer ready to deposit.</li>
            </ul>
            <p>
              Everything settles on X Layer. The base asset is USDT0 throughout, and
              the agent allocates across two real venues: <strong>Aave v3</strong>{" "}
              lending, and <strong>USDG</strong>, a regulated dollar backed by cash and
              short-term U.S. Treasuries (routed via Uniswap and supplied to Aave) for
              real-world-asset-backed yield. Both are proven end-to-end against live X
              Layer mainnet.
            </p>
          </section>

          <section id="risk">
            <h2>The risk engine</h2>
            <p>
              Headline APY is not the objective. The engine converts each
              venue&apos;s raw yield into a risk-adjusted figure by applying a
              transparent, weighted set of haircuts.
            </p>
            <ul>
              <li><strong>Protocol risk.</strong> A base factor for the venue&apos;s maturity and audit surface.</li>
              <li><strong>Liquidity-at-risk.</strong> How much of the position could actually exit, blending market depth against the size Aumo would hold.</li>
              <li><strong>Peg deviation.</strong> How far the underlying has drifted from par.</li>
              <li><strong>Utilization.</strong> How stretched the venue is, which governs whether an exit is available.</li>
              <li><strong>Correlation-aware concentration.</strong> Exposure is penalised by how correlated the venues are, so two names that move together are treated closer to one.</li>
            </ul>
            <p>
              Each venue lands in a band (low, moderate, elevated, or high) and the
              engine ranks on risk-adjusted APY. The full breakdown for the latest
              cycle is visible in the app.
            </p>
          </section>

          <section id="guardrails">
            <h2>Guardrails &amp; trust</h2>
            <p>
              Because Aumo moves real money, the limits live in the contract, not
              in the agent&apos;s code.
            </p>
            <ul>
              <li><strong>Per-move cap.</strong> The most that can move in a single transaction.</li>
              <li><strong>Per-venue cap.</strong> The most that can sit in any one venue.</li>
              <li><strong>Max total deployed.</strong> The ceiling on how much of the pool is ever at work.</li>
              <li><strong>Per-epoch loss budget.</strong> A swap venue costs a small spread on each round trip, so even the value a rogue agent could burn by churning is capped per epoch. Your own withdrawals are never subject to it, so you can always exit.</li>
              <li><strong>Allowlisted venues only.</strong> The agent can send funds nowhere else.</li>
              <li><strong>No external withdrawal path.</strong> The agent can shuffle funds between allowlisted venues and back to the pool. It cannot withdraw to any outside address.</li>
            </ul>
            <p>
              Ownership uses a two-step transfer and renouncing is disabled, so the
              vault can never be left ownerless. The pool can be paused. Every
              decision is bound to a fingerprint of the governing policy, so a
              change in behaviour is always traceable to a change in policy.
            </p>
          </section>

          <section id="deposit">
            <h2>Deposit &amp; withdraw</h2>
            <p>
              Deposit USDT0 into the pool and receive ERC-4626 shares. Those shares
              are your claim on a pro-rata slice of everything the agent earns. The
              first deposit needs a one-time approval so the pool can pull your
              USDT0, then the deposit itself. Withdraw at any time by redeeming
              shares for USDT0 at the current share price.
            </p>
            <p>
              {isMainnet
                ? "Aumo is live on X Layer. You need USDT0 and a little OKB for gas."
                : "Aumo is currently on X Layer testnet. You need testnet USDT0 and a little OKB for gas."}
            </p>
          </section>

          <section id="bridge">
            <h2>Bridging in</h2>
            <p>
              USDT0 is a LayerZero OFT, so you can fund your position from another
              chain. Pick a source chain and amount, and Aumo quotes the real route
              and messaging fee from the OFT. The bridged USDT0 arrives on X Layer
              ready to deposit.{" "}
              {isMainnet
                ? "Bridging executes from your wallet on the source chain."
                : "On testnet the flow previews the genuine route and fee."}
            </p>
          </section>

          <section id="faq">
            <h2>FAQ</h2>
            <h3>Can the agent run off with my funds?</h3>
            <p>
              No. It can only move funds between allowlisted venues and back to the
              pool, within on-chain caps. There is no code path that sends funds to
              an arbitrary address.
            </p>
            <h3>What happens if the agent goes offline?</h3>
            <p>
              Nothing happens to your funds. Deposits and withdrawals are contract
              functions that work whether or not the agent is running. An offline
              agent simply stops rebalancing.
            </p>
            <h3>Is this audited?</h3>
            <p>
              {isMainnet
                ? "Aumo runs on X Layer mainnet with conservative caps. "
                : "Aumo is experimental software on testnet. "}
              The contracts have been hardened and reviewed, but they have not completed
              a formal third-party audit. Do not deposit funds you cannot afford to lose.
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
