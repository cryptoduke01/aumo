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
              The newest thing the agent can do is provide liquidity itself, not just park money in a
              lender. Here is the whole flow, one tap at a time.
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

          <Drawer title="Who holds the keys" teaser="Turnkey TEE, and how funds arrive">
            <p>
              On mainnet the agent&apos;s signing key lives in a Turnkey secure enclave, under a policy that
              only lets it call the two pool functions, never a transfer out and never a deposit. So even a
              compromised signer cannot self-deal. Deposits can start on Ethereum, Arbitrum, Optimism, or
              Polygon and land on X Layer through USDT0&apos;s native bridge, no wrapped-asset detour.
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
        </section>
      </div>
    </div>
  );
}
