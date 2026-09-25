import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DitherMark } from "@/components/dither-mark";
import { LpFlow } from "@/components/lp-flow";

export const metadata: Metadata = {
  title: "Internals · Aumo",
  description:
    "The nerd page: how Aumo actually works, hands-on. Click through the liquidity flow and open the drawers for the real math.",
};

// A click-to-open drawer, so the deep math is there for whoever wants it without being a wall of text.
function Drawer({ title, teaser, children }: { title: string; teaser: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-border bg-card p-5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{title}</span>
          <span className="text-xs text-faint">{teaser}</span>
        </span>
        <span className="shrink-0 text-faint transition-transform duration-200 group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

function Eq({ children }: { children: ReactNode }) {
  return (
    <span className="block rounded-lg border border-border bg-card-2 px-4 py-3 font-mono text-[13px] text-foreground/90">
      {children}
    </span>
  );
}

export default function InternalsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="relative border-b border-border/70 py-16">
        <DitherMark className="pointer-events-none absolute right-0 top-12 hidden size-40 text-foreground/[0.12] sm:block" />
        <span className="text-xs uppercase tracking-[0.14em] text-accent">Internals · the nerd page</span>
        <h1 className="relative mt-3 text-4xl font-medium tracking-tight sm:text-5xl">How Aumo actually works</h1>
        <p className="relative mt-4 text-muted-foreground">
          No marketing gloss down here. This is the real machinery: how the agent thinks, where your money
          goes, and the math behind every move. Poke at it. Everything maps to code you can read and
          transactions you can check.
        </p>
      </header>

      <div className="flex flex-col gap-10 py-14">
        {/* Interactive centerpiece: the LP flow, click-through. */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-medium text-foreground">Watch it provide liquidity</h2>
            <p className="text-sm text-muted-foreground">
              One thing the agent can do in the safe pool is provide liquidity itself, not just park
              money in a lender. Here is the whole flow, one tap at a time. (The opt-in stock, basket,
              and gold pools are in their own drawers below.)
            </p>
          </div>
          <LpFlow />
          <p className="text-xs text-faint">
            Right now the agent holds this at $0 on purpose: full-range fees on a pegged pair are thin, so
            it waits until the yield actually beats the alternatives (the X Layer RWA incentives are the
            trigger). When it funds it, the fees compound into your share price, no claim button.
          </p>
        </section>

        {/* Everything else, in drawers. Informal on the outside, real math on the inside. */}
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-foreground">Open the hood</h2>

          <Drawer title="Where your money lives" teaser="The pool, and how shares actually work">
            <p>
              You put in USDT0 and get <code>aumoUSDT0</code> shares back. It is a standard ERC-4626 vault,
              which is a fancy way of saying: your shares are a claim on the whole pot, and yield shows up
              as your share getting more valuable, not as a separate reward you have to claim.
            </p>
            <p>What the pool is worth at any moment:</p>
            <Eq>totalAssets = idle USDT0 + Σ (each venue&apos;s live balance)</Eq>
            <p>
              Each venue&apos;s balance is read live and wrapped in a try/catch, so one flaky venue can never
              brick the whole number. First-depositor inflation (the classic 4626 attack) is neutralized with
              a decimals offset of 6. Ownership is two-step and cannot be renounced, so the pool is never
              left ownerless. And redemptions are never pausable, so you can always get out.
            </p>
          </Drawer>

          <Drawer title="The rules it literally cannot break" teaser="Guardrails live in the contract, not the agent">
            <p>
              The agent is smart but not trusted. Every limit is enforced by the pool itself, so the worst a
              buggy or hijacked agent can do is get a transaction reverted.
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>A cap on how much moves per transaction, per venue, and in total.</li>
              <li>An allowlist: funds can only reach approved venues, never some random address.</li>
              <li>
                A rolling <strong>loss budget</strong>: every swap spread it burns is metered, and once the
                window&apos;s budget is spent, further lossy moves revert.
              </li>
              <li>A <strong>deploy budget</strong> that rate-limits how fast it can churn capital.</li>
            </ul>
            <p>Caps check real exposure, not just booked principal:</p>
            <Eq>exposure = max(principal, live balance)</Eq>
          </Drawer>

          <Drawer title="How it picks a venue" teaser="The risk brain, in actual numbers">
            <p>
              It never chases the biggest APY. It breaks each venue into risk pieces, blends them with fixed
              weights, and haircuts the yield by the result. The blend:
            </p>
            <Eq>risk = 0.30·protocol + 0.25·liquidity + 0.20·peg + 0.15·utilization + 0.10·concentration</Eq>
            <p>
              Then it adds a trend penalty if the venue is getting worse, plus two RWA-specific alarms: a
              hit if the venue&apos;s live data went stale, and a bigger hit if you could not actually exit it
              right now (a lending market borrowed to the hilt, or a position bigger than the exit door).
              Concentration is correlation-aware, so stacking two similar venues does not count as
              diversifying. What it ranks on is never the raw APY:
            </p>
            <Eq>risk-adjusted yield = APY × (1 − risk)</Eq>
          </Drawer>

          <Drawer title="Why it just sits there sometimes" teaser="Holding is a decision, not a nap">
            <p>
              It rotates capital only when the move pays for itself. Two things usually say &quot;don&apos;t
              bother&quot;: the best venue is already at its concentration cap (it cannot legally add more),
              or the edge is real but cannot beat the round-trip swap cost before the position matures.
            </p>
            <p>
              For a fixed-maturity venue like a Pendle PT, only the yield capturable before it matures counts.
              So a juicy headline edge on something maturing in two months often does not justify the ~100bps
              it costs to get in and out. Holding, in that case, is the agent being disciplined, not idle.
            </p>
          </Drawer>

          <Drawer title="The venues, one by one" teaser="Aave, USDG, Pendle, and the LP">
            <p><strong>Aave v3.</strong> Supplies USDT0, holds the interest-bearing aToken. Simple.</p>
            <p>
              <strong>USDG.</strong> Swaps USDT0 to USDG behind a slippage floor, then supplies it to Aave
              for real-world-asset yield.
            </p>
            <p>
              <strong>Pendle PT-USDG.</strong> Buys the Principal Token for a fixed rate to maturity. Valued
              off a TWAP oracle (never a spot price you could yank around) and clamped at par.
            </p>
            <p>
              <strong>USDG/USDT0 LP.</strong> The liquidity venue from the walkthrough above. It vendors
              Uniswap&apos;s own math exactly, values the position through a peg-band-clamped price so a
              manipulated spot cannot fake a gain, and reads its live fee APY from the pool&apos;s fee growth:
            </p>
            <Eq>fee yield over a period = (Δ feeGrowth0 + Δ feeGrowth1) / 2^129</Eq>
            <p>annualized by the elapsed time, in full-precision integer math.</p>
          </Drawer>

          <Drawer title="The at-risk pools: stocks, a basket, and gold" teaser="Opt-in price exposure, walled off from the safe pool">
            <p>
              Separate from the safe treasury, these pools deliberately hold price risk you chose. Each
              is its own isolated ERC-4626 pool built on <code>EquityPool</code>, a subclass of{" "}
              <code>AumoPool</code>, so it inherits the same per-move, per-venue, and total caps, the
              allowlist, two-step ownership, and the no-external-withdrawal rule, and adds two
              equity-specific behaviours.
            </p>
            <p>
              <strong>Market hours, enforced by the contract.</strong> Entry and exit are gated on the
              equity oracle being fresh. The feed only ticks while the US market is open, so a stale
              price is the market-closed signal and the pool refuses to admit or redeem then. Nobody
              gets to trade a weekend gap against the holders who stay.
            </p>
            <p>
              <strong>How the money moves.</strong> <code>EquityAdapter</code> converts USDT0 into the
              wrapped xStock and back through Uniswap v3, routing USDT0 &rarr; USDG &rarr; xStock when
              the stock&apos;s liquidity sits against USDG. Every swap carries an oracle-derived minimum
              out, so a manipulated pool reverts instead of filling far from fair value.
            </p>
            <p>
              The four single-stock pools (NVIDIA, Apple, Microsoft, Meta) buy and hold. There is no
              timing rule; we tested one and removed it (see the <a href="/research">research note</a>).
              The basket is one <code>EquityPool</code> holding all four equal-weight through four
              adapters, and the agent&apos;s only move is to rebalance back toward equal weight when
              drift crosses a band.
            </p>
            <p>
              <strong>Gold.</strong> A separate pool holds PAXGy, Paxos&apos; yield-bearing tokenized
              gold. It routes USDT0 &rarr; USDG &rarr; PAXGy the same way and prices the position from
              PAXGy&apos;s own on-chain gold rate times a gold feed. The gold entitlement grows over
              time, so you earn a yield denominated in gold on top of the price. Gold moves in dollars,
              so this is not capital preservation either.
            </p>
          </Drawer>

          <Drawer title="The price oracle Aumo runs (for now)" teaser="Self-hosted, disclosed, and swappable for a network feed">
            <p>
              The stocks and gold need a price on-chain. Aumo runs a{" "}
              <code>SelfHostedEquityOracle</code>: an off-chain feeder pulls quotes, scales
              USD-per-share to 1e18, resolves whether the US market is open, and posts through a single
              trusted updater key.
            </p>
            <p>
              Stated plainly: that key is the source of truth. It is a weaker guarantee than a
              decentralized feed, and it is disclosed to depositors. It is also deliberate and
              temporary. Every consumer reads through an oracle-agnostic interface
              (<code>IEquityOracle</code>), so switching to a verified network feed later is one owner
              call on the adapter, with no depositor action.
            </p>
            <p>
              The submit path is bounded so a bad feed or a stolen key can only do so much damage: a
              registered-feed allowlist, a monotonic timestamp (no rollback to an old price), a
              future-skew bound, an absurd-price cap, and an owner-dialable per-update deviation
              circuit-breaker. Gold is priced from the token&apos;s own rate times a gold feed:
            </p>
            <Eq>PAXGy price = getRate() × gold/USD</Eq>
          </Drawer>

          <Drawer title="The anti-dilution levy" teaser="Why joining or leaving an at-risk pool costs a few bps">
            <p>
              The at-risk pools charge 0.25% on entry and 0.50% on exit, and the money stays in the
              pool. It is not a protocol fee; the contract caps it so the owner can never turn it into
              one.
            </p>
            <p>
              What it fixes: an internal security pass proved two Medium issues with fork PoCs.
              Exit-slippage socialization meant a leaver&apos;s swap cost landed on the people who
              stayed. A NAV-latency skim meant someone could trade against a slightly stale mark in the
              gap after an oracle update. The levy makes a joiner or leaver bear the value their own
              action moves, and a tighter staleness window closes the skim. Both shipped in a hardened
              redeploy to mainnet before deposits opened.
            </p>
          </Drawer>

          <Drawer title="The AI provider is swappable" teaser="Groq or Anthropic, same tighten-only bound">
            <p>
              The reasoning layer, the specialist panel, and the Ask Aumo endpoint speak an
              OpenAI-compatible interface, so they run on Groq or on Anthropic depending on a config
              key.
            </p>
            <p>
              The safety does not depend on which one answers. Whatever the model returns can only
              tighten the deterministic plan, and the contract re-checks every guardrail after it, so a
              swap changes the wording of the reasoning, never what the agent is allowed to do.
            </p>
          </Drawer>

          <Drawer title="Receipts for everything" teaser="Every decision, provable after the fact">
            <p>
              Every cycle writes a receipt: what it saw, the risk scores, the plan and why, the transaction
              hashes, and a fingerprint of the exact guardrails in force. So any change in behavior traces
              back to a change in policy. Performance is measured as honestly as it gets: the growth of your
              share price.
            </p>
            <Eq>price per share = totalAssets / totalSupply</Eq>
            <p>
              Idle money keeps that flat; the agent&apos;s job is to grow it, net of every cost. A fresh
              deposit dips it briefly by the one-time cost of deploying, which is earned back, so the number
              only gets reported once there is a fair window behind it. The whole trail exports as CSV.
            </p>
          </Drawer>

          <Drawer title="Who holds the keys" teaser="The signer is untrusted by design">
            <p>
              The agent signs with an ordinary key, and the design assumes that key could be
              compromised at any moment. That is the point: the safety does not come from hiding the
              key, it comes from the contract. Even holding the signing key, the only moves it permits
              are allocating to an allowlisted venue and pulling funds back to the pool. No function
              sends money to an outside address, so a stolen signer still cannot drain a cent. Deposits
              can start on Ethereum, Arbitrum, Optimism, or Polygon and land on X Layer through
              USDT0&apos;s native bridge, no wrapped-asset detour.
            </p>
          </Drawer>

          <Drawer title="Is my money safe?" teaser="The honest version">
            <p>
              The thing Aumo removes is trusting the agent: it cannot exceed the on-chain caps and cannot
              send funds to an outside address, so a rogue agent cannot steal. What you still trust is the
              venues themselves, the correctness of the contracts, and the owner key that sets policy. The
              pool and adapters have a unit suite plus a stateful invariant suite, every adapter is
              fork-proven against live contracts, and new money-code gets a multi-pass adversarial review.
              Aumo is experimental and has not had a formal third-party audit yet. That is the truth, plainly.
            </p>
          </Drawer>

          <Drawer title="The deployed contracts" teaser="Everything live on X Layer, checkable on the explorer">
            <p>
              Everything runs on X Layer mainnet. Read the code, then check every move on the{" "}
              <a href="https://www.oklink.com/xlayer" target="_blank" rel="noreferrer">
                X Layer explorer
              </a>
              .
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Safe stablecoin pool: <code>0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F</code></li>
              <li>Shared equity and gold oracle: <code>0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2</code></li>
              <li>NVIDIA pool: <code>0x9781cD1f02045c072D7D1915a215c9E46b49E1dB</code></li>
              <li>Apple pool: <code>0xDcd9c0C948ebb4D63d88FA5EC8eDE571eF1BE523</code></li>
              <li>Microsoft pool: <code>0xbe0A87F49F424D3170804e29E5969a379Fe65626</code></li>
              <li>Meta pool: <code>0x47343D8a880c84aD1a6aD679FEdd0DC23fdA8BcC</code></li>
              <li>Diversified basket pool: <code>0xFe01b81F5D22Ac3647424904f7DC7ecC9EA0358d</code></li>
              <li>Tokenized gold (PAXGy) pool: <code>0xf1833C4eAEb42df6D9eE33ea090055cf690cee56</code></li>
            </ul>
            <p>
              These are the hardened pools, redeployed after the internal security pass; they supersede
              the earlier pre-hardening equity addresses.
            </p>
          </Drawer>
        </section>
      </div>
    </div>
  );
}
