import type { Metadata } from "next";
import { DitherField } from "@/components/dither-field";
import { DitherMark } from "@/components/dither-mark";

export const metadata: Metadata = {
  title: "Tokenomics · Aumo",
  description:
    "$AUMO: the funding, access, and governance token of Aumo, a live autonomous real-world-asset treasury agent on X Layer. Supply, allocation, use of proceeds, revenue, and roadmap.",
  // Pre-launch draft: keep it out of search until the raise is public.
  robots: { index: false, follow: false },
};

const GOLD = "#ffbc3e";

type Slice = { label: string; value: number; purpose: string; dot: number; alpha: number };
const ALLOCATION: Slice[] = [
  { label: "Community / fair launch", value: 40, purpose: "The raise, sold through the launch", dot: 1.75, alpha: 1 },
  { label: "Treasury", value: 30, purpose: "Protocol-owned liquidity, audit, growth, buybacks", dot: 1.4, alpha: 0.9 },
  { label: "Team & core contributors", value: 25, purpose: "The people building it", dot: 1.1, alpha: 0.78 },
  { label: "Ecosystem & partnerships", value: 5, purpose: "Integrations and future incentives", dot: 0.8, alpha: 0.62 },
];

// point on a circle, 0deg = top, clockwise
function pt(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: +(cx + r * Math.cos(a)).toFixed(3), y: +(cy + r * Math.sin(a)).toFixed(3) };
}

/** A dithered donut: each segment is an annular sector filled with an ordered gold dot pattern
 *  whose density tracks the segment's weight. Pure SVG, brand-native, no dependency. */
function DitheredDonut({ size = 300 }: { size?: number }) {
  const c = size / 2;
  const R = size * 0.46;
  const r = size * 0.29;
  const gap = 2.4; // deg between segments
  const total = ALLOCATION.reduce((a, s) => a + s.value, 0);
  let cursor = 0;
  const segs = ALLOCATION.map((s, i) => {
    const span = (s.value / total) * 360;
    const a0 = cursor + gap / 2;
    const a1 = cursor + span - gap / 2;
    cursor += span;
    const large = a1 - a0 > 180 ? 1 : 0;
    const o0 = pt(c, c, R, a0), o1 = pt(c, c, R, a1);
    const i1 = pt(c, c, r, a1), i0 = pt(c, c, r, a0);
    const d = `M ${o0.x} ${o0.y} A ${R} ${R} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${r} ${r} 0 ${large} 0 ${i0.x} ${i0.y} Z`;
    return { d, i };
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" role="img" aria-label="Token allocation">
      <defs>
        {ALLOCATION.map((s, i) => (
          <pattern key={i} id={`dith-${i}`} width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="1.75" cy="1.75" r={s.dot} fill={GOLD} fillOpacity={s.alpha} />
            <circle cx="5.25" cy="5.25" r={s.dot} fill={GOLD} fillOpacity={s.alpha} />
          </pattern>
        ))}
      </defs>
      {/* track */}
      <circle cx={c} cy={c} r={(R + r) / 2} fill="none" stroke="var(--surface-2)" strokeWidth={R - r} />
      {segs.map((s) => (
        <path key={s.i} d={s.d} fill={`url(#dith-${s.i})`} stroke="var(--background)" strokeWidth="1.5" />
      ))}
      <text x={c} y={c - 6} textAnchor="middle" className="fill-foreground" style={{ fontSize: size * 0.11, fontWeight: 600 }}>1B</text>
      <text x={c} y={c + size * 0.075} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: size * 0.045, letterSpacing: "0.08em" }}>$AUMO SUPPLY</text>
    </svg>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/[0.06] px-3 py-1 text-xs font-medium text-accent">
      {children}
    </span>
  );
}

const cut = { ["--cut" as string]: "14px" };

export default function TokenomicsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
      {/* Hero */}
      <header className="relative isolate overflow-hidden rounded-2xl border border-border/70 bg-card px-6 py-16 sm:px-12 sm:py-20">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.5]">
          <DitherField cell={3} coreY={0.62} intensity={0.7} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-card to-transparent" />
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-[0.18em] text-accent">Tokenomics · $AUMO</span>
          <Chip>Fair launch on Ignix</Chip>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Draft, being finalized</span>
        </div>
        <h1 className="mt-5 max-w-2xl text-balance text-4xl font-medium leading-[1.05] tracking-tight sm:text-6xl">
          The token of a <span className="text-accent">live</span> RWA agent
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
          $AUMO funds Aumo&apos;s next stage, rewards early holders with real access, and grows into fee
          accrual and governance. Not a meme, and not a claim on the vault&apos;s yield. A token with a job.
        </p>
      </header>

      {/* Token details */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Ticker", "$AUMO"],
          ["Chain", "X Layer · ERC-20"],
          ["Supply", "1,000,000,000"],
          ["Launch", "Ignix · fair launch"],
        ].map(([label, value]) => (
          <div key={label} className="chamfer border border-border bg-card p-5" style={cut}>
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <div className="tnum mt-2 text-lg font-medium tracking-tight text-foreground">{value}</div>
          </div>
        ))}
      </section>

      {/* Allocation */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-border pb-4">
          <h2 className="text-2xl font-medium tracking-tight">Allocation</h2>
          <span className="text-xs text-muted-foreground">1,000,000,000 $AUMO, fixed</span>
        </div>
        <div className="mt-8 grid items-center gap-10 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="mx-auto aspect-square w-full max-w-[340px]">
            <DitheredDonut />
          </div>
          <div className="flex flex-col divide-y divide-border/70">
            {ALLOCATION.map((s, i) => (
              <div key={s.label} className="flex items-center gap-4 py-4">
                <div className="chamfer size-10 shrink-0 overflow-hidden border border-border" style={{ ["--cut" as string]: "6px" }}>
                  <svg viewBox="0 0 20 20" className="h-full w-full">
                    <rect width="20" height="20" fill="var(--surface-2)" />
                    {Array.from({ length: 9 }).map((_, k) => (
                      <circle key={k} cx={3 + (k % 3) * 7} cy={3 + Math.floor(k / 3) * 7} r={s.dot} fill={GOLD} fillOpacity={s.alpha} />
                    ))}
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-foreground">{s.label}</span>
                    <span className="tnum text-lg font-medium text-accent">{s.value}%</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{s.purpose}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What the token does */}
      <section className="mt-16">
        <h2 className="border-b border-border pb-4 text-2xl font-medium tracking-tight">What $AUMO does</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Funds the next stage", "The raise pays for an external security audit, deeper pool liquidity, new assets, and infrastructure."],
            ["Access for early holders", "Reduced protocol fees and first access to new pools before they open publicly. Ships shortly after launch."],
            ["Curates the trust layer", "Aumo decides which real-world-asset venues are safe. Holders help propose and vet them, the one thing only Aumo does."],
            ["Fee-backed treasury", "A share of protocol fees funds a treasury that buys back $AUMO. Value flows to the treasury the token governs."],
            ["Progressive governance", "The policy levers, the venue allowlist, risk caps, new assets, and fees, move to holders as it decentralizes."],
            ["Backed by a live product", "Stablecoin yield, tokenized stocks, a basket, and gold already run on X Layer mainnet, audited and hardened."],
          ].map(([title, body]) => (
            <div key={title} className="chamfer flex flex-col gap-2 border border-border bg-card p-5" style={cut}>
              <span className="font-medium text-foreground">{title}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{body}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Use of proceeds */}
      <section className="mt-16">
        <h2 className="border-b border-border pb-4 text-2xl font-medium tracking-tight">Use of proceeds</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Security audit", "An external audit of every pool."],
            ["Liquidity", "Protocol-owned liquidity for the RWA pools, the current product gap."],
            ["New assets", "Adding more tokenized real-world assets."],
            ["Infrastructure", "The oracle feeder, infra, and operations."],
          ].map(([title, body], i) => (
            <div key={title} className="chamfer border border-border bg-card p-5" style={cut}>
              <span className="tnum text-sm text-accent">0{i + 1}</span>
              <div className="mt-2 font-medium text-foreground">{title}</div>
              <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Revenue & value link */}
      <section className="mt-16">
        <h2 className="border-b border-border pb-4 text-2xl font-medium tracking-tight">Revenue &amp; value link</h2>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_minmax(0,320px)]">
          <p className="text-base leading-relaxed text-muted-foreground">
            Aumo&apos;s sustainable revenue is the asset-manager model: a performance fee on the yield the
            agent generates, so the protocol earns only when depositors earn, and optionally a small
            management fee on assets. Fees route to the treasury, which buys back $AUMO. It scales with
            deposits, so it grows as the pools grow. It is framed as treasury and governance, never as
            staking $AUMO to earn the vault&apos;s returns, which keeps it clear of the securities line.
          </p>
          <div className="chamfer flex flex-col gap-3 border border-border bg-card p-5" style={cut}>
            {["Agent earns yield for depositors", "Performance fee", "Protocol treasury", "Buys back $AUMO"].map((step, i, arr) => (
              <div key={step} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="tnum flex size-6 shrink-0 items-center justify-center rounded-full border border-accent/40 text-[11px] font-medium text-accent">{i + 1}</span>
                  <span className="text-sm text-foreground">{step}</span>
                </div>
                {i < arr.length - 1 ? <span className="ml-3 h-4 w-px bg-border" aria-hidden /> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section className="mt-16">
        <h2 className="border-b border-border pb-4 text-2xl font-medium tracking-tight">Roadmap</h2>
        <ol className="mt-8 space-y-0">
          {[
            ["Launch", "Fair launch on Ignix. Treasury and liquidity seeded, audit commissioned."],
            ["Near-term", "Holder fee discount and early access live. External audit published."],
            ["Mid-term", "Curation staking for venue vetting. Performance fee turned on and routed to the treasury buyback."],
            ["Long-term", "Policy levers handed to $AUMO governance as the protocol decentralizes."],
          ].map(([title, body], i, arr) => (
            <li key={title} className="relative flex gap-5 pb-8 last:pb-0">
              <div className="relative flex flex-col items-center">
                <span className="mt-1 size-3 shrink-0 rounded-full bg-accent ring-4 ring-accent/15" />
                {i < arr.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" aria-hidden /> : null}
              </div>
              <div className="pb-2">
                <div className="font-medium text-foreground">{title}</div>
                <div className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{body}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Notes */}
      <section className="relative mt-16 overflow-hidden rounded-xl border border-border bg-card p-6 sm:p-8">
        <DitherMark className="pointer-events-none absolute -right-6 -top-6 size-36 text-foreground/[0.06]" />
        <h2 className="text-sm font-medium text-foreground">Notes</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Aumo&apos;s product is live on X Layer mainnet, and the pools were internally security-audited and
          hardened before taking deposits. The treasury is on-chain and its spending is disclosed. $AUMO is
          a funding, utility, and governance token. It is not a deposit, not a share of the protocol, and
          not investment advice. Value accrual and any protocol fee are subject to legal review before they
          go live. Figures on this page are the current plan and are being finalized with the launch partner.
        </p>
      </section>
    </div>
  );
}
