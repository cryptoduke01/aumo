import type { Metadata } from "next";
import { DitherMark } from "@/components/dither-mark";

export const metadata: Metadata = {
  title: "Tokenomics · Aumo",
  description:
    "$AUMO: the funding, access, and governance token of Aumo, a live autonomous real-world-asset treasury agent on X Layer. Supply, allocation, use of proceeds, and roadmap.",
  // Pre-launch draft: keep it out of search and the nav until the raise is public.
  robots: { index: false, follow: false },
};

export default function TokenomicsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="relative border-b border-border/70 py-16">
        <DitherMark className="pointer-events-none absolute right-0 top-12 hidden size-40 text-foreground/[0.12] sm:block" />
        <span className="text-xs uppercase tracking-[0.14em] text-accent">Tokenomics · $AUMO</span>
        <h1 className="relative mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
          The token of a live RWA agent
        </h1>
        <p className="relative mt-4 text-muted-foreground">
          $AUMO funds Aumo&apos;s next stage, rewards early holders with access, and grows into fee
          accrual and governance. Figures below are the current plan and are being finalized with the
          launch partner.
        </p>
      </header>

      <article className="prose py-14">
        <h2>What $AUMO is</h2>
        <p className="lead">
          Aumo is an autonomous AI treasury agent live on X Layer mainnet. You deposit a stablecoin and
          the agent manages it on-chain inside guardrails written into the contract, with a receipt for
          every move. It already runs a safe stablecoin yield pool, tokenized-stock pools, a diversified
          basket, and a tokenized-gold pool. $AUMO is the funding, access, and future-governance token of
          that live protocol. It is not a meme, and it is not a claim on the protocol&apos;s yield.
        </p>

        <h2>What the token does</h2>
        <ul>
          <li>
            <strong>Funds the next stage.</strong> The raise pays for an external security audit, deeper
            liquidity for the stock, basket, and gold pools, new assets, and infrastructure.
          </li>
          <li>
            <strong>Rewards early holders.</strong> Reduced protocol fees and first access to new pools
            and assets before they open publicly. Ships shortly after launch.
          </li>
          <li>
            <strong>Curates the trust layer.</strong> Aumo&apos;s core job is deciding which real-world-asset
            venues are safe to hold. $AUMO holders help propose and vet those venues, tying the token to
            the one thing Aumo does that nobody else does.
          </li>
          <li>
            <strong>Accrues value through a treasury.</strong> A share of protocol fees funds a treasury
            that buys back $AUMO. Value flows to the treasury the token governs, not to holders as yield.
          </li>
          <li>
            <strong>Governs, progressively.</strong> As the protocol decentralizes, the policy levers (the
            venue allowlist, risk caps, new-asset decisions, and fee levels) move to $AUMO holders.
          </li>
        </ul>

        <h2>Token details</h2>
        <ul>
          <li><strong>Ticker:</strong> $AUMO</li>
          <li><strong>Chain:</strong> X Layer (chain 196), ERC-20</li>
          <li><strong>Supply:</strong> 1,000,000,000 (fixed, no inflation)</li>
          <li><strong>Launch:</strong> fair launch on Ignix</li>
        </ul>

        <h2>Allocation</h2>
        <table>
          <thead>
            <tr>
              <th>Allocation</th>
              <th>Share</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Community / fair launch</td><td>40%</td><td>The raise, sold through the launch</td></tr>
            <tr><td>Treasury</td><td>30%</td><td>Protocol-owned liquidity, audit, growth, buybacks</td></tr>
            <tr><td>Team and core contributors</td><td>25%</td><td>The people building it</td></tr>
            <tr><td>Ecosystem and partnerships</td><td>5%</td><td>Integrations and future incentives</td></tr>
          </tbody>
        </table>

        <h2>Use of proceeds</h2>
        <ol>
          <li>External security audit of the pools</li>
          <li>Protocol-owned liquidity for the real-world-asset pools</li>
          <li>Adding new tokenized assets</li>
          <li>Oracle feeder, infrastructure, and operations</li>
        </ol>

        <h2>Revenue and value link</h2>
        <p>
          Aumo&apos;s sustainable revenue is the asset-manager model: a performance fee on the yield the
          agent generates, so the protocol earns only when depositors earn, and optionally a small
          management fee on assets under management. Fees route to the treasury, which buys back $AUMO.
          This scales with deposits. It is framed as treasury and governance, never as staking $AUMO to
          earn the vault&apos;s returns.
        </p>

        <h2>Roadmap</h2>
        <ul>
          <li><strong>Launch.</strong> Fair launch on Ignix, treasury and liquidity seeded, audit commissioned.</li>
          <li><strong>Near-term.</strong> Holder fee discount and early access live; external audit published.</li>
          <li><strong>Mid-term.</strong> Curation staking for venue vetting; performance fee turned on and routed to the treasury buyback.</li>
          <li><strong>Long-term.</strong> Policy levers handed to $AUMO governance as the protocol decentralizes.</li>
        </ul>

        <h2>Notes</h2>
        <p>
          Aumo&apos;s product is live on X Layer mainnet, and the pools were internally security-audited and
          hardened before taking deposits. The treasury is on-chain and its spending is disclosed. $AUMO is
          a funding, utility, and governance token. It is not a deposit, not a share of the protocol, and
          not investment advice. Value accrual and any protocol fee are subject to legal review before they
          go live.
        </p>
      </article>
    </div>
  );
}
