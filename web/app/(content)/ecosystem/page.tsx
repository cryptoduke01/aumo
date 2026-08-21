import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ecosystem · Aumo",
  description:
    "How Aumo, an autonomous AI treasury for stablecoins, brings idle dollar liquidity into X Layer's real-world-asset economy, deepens the protocols it earns in, and compounds the ecosystem it is built on.",
};

function Stat({ figure, label }: { figure: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface/60 p-4">
      <span className="text-2xl font-medium tracking-tight text-foreground">{figure}</span>
      <span className="text-[12px] leading-snug text-muted-foreground">{label}</span>
    </div>
  );
}

export default function EcosystemPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="border-b border-border/70 py-16">
        <span className="text-xs uppercase tracking-[0.14em] text-accent">
          Ecosystem · Aumo · X Layer · August 2026
        </span>
        <h1 className="mt-3 text-balance text-4xl font-medium leading-[1.05] tracking-tight sm:text-[2.9rem]">
          An AI-RWA treasury that grows the ecosystem it earns in
        </h1>

        <div className="mt-8 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/duke.jpg"
            alt="Duke"
            className="size-11 rounded-full border border-border object-cover"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Duke</span>
            <a
              href="https://x.com/dukedotsol"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              @dukedotsol · Aumo · X Layer
            </a>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-surface/60 p-5">
          <span className="text-[11px] uppercase tracking-[0.14em] text-faint">In one paragraph</span>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Aumo is an autonomous treasury for stablecoins on X Layer. You hand it idle dollars; an AI
            agent puts them to work in real-world-asset and lending yield, preservation first, with
            every move guardrailed by a contract and provable on-chain. It is not a walled garden. Aumo
            routes external stablecoin liquidity into X Layer&apos;s own protocols, generates on-chain
            volume as it works, and is built as composable infrastructure that any new venue can plug
            into. It does not extract from the ecosystem. It deepens it.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat figure="3" label="Real yield venues, fork-proven on live X Layer" />
          <Stat figure="1 adapter" label="To onboard any new X Layer venue" />
          <Stat figure="ERC-4626" label="Composable pool other apps can build on" />
          <Stat figure="Day one" label="Pendle integrated the day it launched on X Layer" />
        </div>
      </header>

      <article className="prose py-14">
        <h2 id="s1">1. The opportunity on X Layer</h2>
        <p>
          Stablecoins are the largest liquid asset class in crypto, and most of them sit idle. On X
          Layer specifically, the pieces for productive dollar liquidity have just landed: USDT0 as the
          canonical dollar, Aave v3 for lending, USDG (a Treasury-backed regulated dollar from Paxos)
          for real-world-asset yield, and, as of August 2026, Pendle for fixed-rate yield. What has
          been missing is the layer that turns that infrastructure into something an ordinary holder
          can use safely: an allocator that reasons about risk, never chases a rate off a cliff, and
          proves what it did. That is the gap Aumo fills, and filling it pulls idle dollars off the
          sidelines and into X Layer&apos;s economy.
        </p>

        <h2 id="s2">2. What Aumo is, precisely</h2>
        <p>
          Aumo is an autonomous treasury, not a yield farm. A treasury&apos;s job is to earn a prudent
          return on idle cash while preserving capital and staying liquid, exactly how a corporate
          treasurer runs a money-market ladder or how a stablecoin issuer earns on its reserves. Aumo
          does that job in software: deposit USDT0 into a shared ERC-4626 vault, receive pool shares,
          and an AI agent allocates the pooled balance across allowlisted venues to the best
          risk-adjusted yield, inside caps enforced on-chain. Because the assets are dollar-pegged,
          the return is income (lending interest, RWA yield, fixed Pendle yield), not speculation.
        </p>

        <h2 id="s3">3. The AI is real, and it is constrained</h2>
        <p>
          Aumo scores each venue by decomposing risk into bounded sub-scores, adds a temporal signal
          learned from its own recorded history, stress-tests every candidate allocation against
          adverse scenarios, convenes a panel of specialist agents (peg, liquidity, macro), and passes
          the plan through an adversarial critic that can veto or hold. A language-model layer sits on
          top under a formal tighten-only property: it can make a plan more conservative but never
          looser, and every guardrail is re-checked by the contract after it answers. Every decision
          is written to a receipt anyone can replay. The full method, with the math and a deterministic
          backtest, is in the <a href="/research">research note</a>.
        </p>

        <h2 id="s4">4. The RWA is real, and it is on X Layer</h2>
        <p>
          Aumo runs three live venues, each fork-proven against real X Layer mainnet contracts, not
          mocks:
        </p>
        <ul>
          <li>
            <strong>Aave v3 (USDT0)</strong>: supplying the canonical dollar for lending interest,
            reading live reserve rates.
          </li>
          <li>
            <strong>USDG</strong>: a tokenized, Treasury-backed regulated dollar (Global Dollar,
            Paxos), supplied for real-world-asset yield. USDT0 is swapped to USDG on X Layer&apos;s own
            DEX with a strict slippage floor, then supplied.
          </li>
          <li>
            <strong>Pendle PT-USDG</strong>: buying the Principal Token to lock in a fixed yield to
            maturity, valued through Pendle&apos;s TWAP oracle (never a spot read), with a market exit
            before maturity and a one-to-one redemption after. Integrated the day Pendle went live on X
            Layer.
          </li>
        </ul>
        <p>
          Fixed yield deserves emphasis. It is the cleanest possible treasury product: a known return,
          on a Treasury-backed dollar, with a defined maturity. It is what a cautious mandate wants,
          and it is now native to X Layer.
        </p>

        <h2 id="s5">5. How Aumo grows X Layer</h2>
        <p>
          This is the part that matters for the ecosystem, and it is structural, not a slogan.
        </p>
        <ul>
          <li>
            <strong>It routes external liquidity in.</strong> Aumo&apos;s reason to exist is to attract
            idle stablecoins and put them to work. Every dollar it manages is supplied into an X Layer
            protocol (Aave, USDG, Pendle), directly deepening that protocol&apos;s TVL and the
            chain&apos;s.
          </li>
          <li>
            <strong>It generates on-chain volume.</strong> Allocating into the RWA and fixed-yield legs
            routes USDT0 and USDG through X Layer&apos;s DEXs on the way in and out. Aumo&apos;s
            activity is DEX activity.
          </li>
          <li>
            <strong>It is composable infrastructure, not a silo.</strong> Venues are reached through a
            single uniform interface (<code>IVenueAdapter</code>). Onboarding any new X Layer yield
            protocol is one small adapter, no change to the core. The vault itself is a standard
            ERC-4626 that other apps can build on. Aumo is a distribution layer for X Layer yield, not
            a competitor to it.
          </li>
          <li>
            <strong>It is a reference integration.</strong> The Pendle adapter, fork-proven and
            open, is a worked example other X Layer builders can follow to integrate the same
            protocols safely, oracle handling and slippage floors included.
          </li>
        </ul>

        <h2 id="s6">6. What the grant funds</h2>
        <p>
          The AI-RWA Liquidity Grant is meant to fund further growth. Ours is concrete and each item
          compounds back into X Layer:
        </p>
        <ul>
          <li>
            <strong>An independent security audit.</strong> The money path is already covered by an
            internal assessment, an invariant suite, and fork tests; an external audit is the one thing
            that takes trust from strong to unimpeachable before scaling deposits.
          </li>
          <li>
            <strong>Deposit liquidity to bootstrap TVL.</strong> Seed and incentivize the vault so real
            stablecoin balances flow through it into X Layer protocols, turning grant capital directly
            into ecosystem TVL and volume.
          </li>
          <li>
            <strong>More venue adapters.</strong> Broaden the RWA surface as X Layer&apos;s protocol set
            grows, each new adapter routing more liquidity into another X Layer venue.
          </li>
          <li>
            <strong>Live market feeds.</strong> A live Pendle and RWA rate reader so the agent prices
            fixed yield and new venues from the chain in real time.
          </li>
        </ul>

        <h2 id="s7">7. Where it stands</h2>
        <p>
          Aumo runs the full stack on X Layer: the pooled vault, the reasoning agent, three live
          venues (Aave lending, a Treasury-backed dollar, and Pendle fixed yield) with a fourth, a
          full-range USDG/USDT0 Uniswap v3 position, shipped and fork-verified, per-depositor
          positions, provable receipts, and an agent whose signing key is held in a secure enclave
          rather than a hot environment. Every venue adapter is fork-proven against live X Layer
          contracts, and the pool is covered by 72 tests including a stateful invariant suite. Launch
          is deliberate by design: the pool deploys paused with conservative caps, and go-live is a
          verified unpause.
        </p>

        <h2 id="s8">8. The compounding thesis</h2>
        <p>
          Most yield products are extractive: they compete with the protocols they sit on for the same
          liquidity. Aumo is additive. It exists to bring dollars that are not on X Layer today onto X
          Layer, and to spread them across the ecosystem&apos;s protocols under a mandate that keeps
          them there safely. Grant capital becomes vault TVL, vault TVL becomes protocol TVL and DEX
          volume, and a trustworthy, auditable allocator becomes the reason the next wave of stablecoin
          liquidity picks X Layer. That is the flywheel, and it is why funding Aumo funds the ecosystem,
          not just the app.
        </p>
      </article>
    </div>
  );
}
