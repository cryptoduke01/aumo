import Link from "next/link";
import { AumoWordmark } from "@/components/mark";
import { LightBars } from "@/components/light-bars";
import { LiveStrip } from "@/components/live-strip";

const cta =
  "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const steps: [string, string][] = [
  ["Deposit", "Fund the pool with USDT0 and receive shares — your slice of everything the agent earns."],
  ["Sense", "It reads live vault state and market data across allowlisted venues."],
  ["Score", "A risk engine haircuts each venue's yield by protocol, liquidity, peg, utilization, and correlation risk. It ranks on risk-adjusted yield, not headline APY."],
  ["Reason", "An LLM reads the market regime and can only make the plan more conservative — never looser than the guardrails."],
  ["Prove", "Every move is capped on-chain, emits a receipt, and is bound to a fingerprint of the exact policy that governed it."],
];

const trust: [string, string][] = [
  ["Guardrails live in the contract", "Per-move, per-venue, and global caps. Allowlisted venues only. The agent physically cannot exceed them."],
  ["It can never take your funds", "The agent only shuffles the pool between allowlisted venues and back. It cannot withdraw to any address."],
  ["Every decision is auditable", "A plain-language rationale per move, bound to a fingerprint of the policy in force, anchored by on-chain receipts."],
];

export default function Landing() {
  return (
    <div className="flex flex-1 flex-col">
      {/* announcement */}
      <Link href="/app" className="group block border-b border-border/60 bg-card/30">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-positive" />
          The agent is live on X Layer
          <span className="text-primary transition-opacity group-hover:opacity-80">watch it work →</span>
        </div>
      </Link>

      {/* nav */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <AumoWordmark />
        </Link>
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          <NavLink href="#how">How it works</NavLink>
          <NavLink href="#trust">Trust</NavLink>
          <NavLink href="/app/activity">Activity</NavLink>
        </nav>
        <Link href="/app" className={`${cta} bg-primary text-primary-foreground hover:opacity-90`}>
          Launch app
        </Link>
      </header>

      {/* hero */}
      <section className="relative isolate overflow-hidden border-b border-border">
        <LightBars />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center sm:py-32">
          <span className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            Autonomous RWA-yield agent · X Layer
          </span>
          <h1 className="text-balance text-5xl font-semibold leading-[1.03] tracking-tight sm:text-7xl">
            Give a stablecoin
            <br />
            <span className="text-primary">a job.</span>
          </h1>
          <p className="max-w-xl text-balance text-lg leading-relaxed text-muted-foreground">
            Deposit USDT0. An AI agent puts it to work in tokenized real-world-asset yield,
            rebalances inside on-chain guardrails, and proves every move.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/app" className={`${cta} bg-primary text-primary-foreground hover:opacity-90`}>
              Launch app
            </Link>
            <Link href="#how" className={`${cta} border border-border hover:border-primary`}>
              How it works
            </Link>
          </div>
          <div className="mt-8 w-full border-t border-border/50 pt-6">
            <LiveStrip />
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight">
            Five steps, every cycle. All provable.
          </h2>
          <ol className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex flex-col gap-3 bg-card p-5">
                <span className="tnum font-mono text-xs text-primary">0{i + 1}</span>
                <span className="font-semibold">{title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* trust */}
      <section id="trust" className="border-b border-border bg-card/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <SectionLabel>Trust model</SectionLabel>
          <h2 className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight">
            Control lives in the contract, not the agent.
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Aumo moves real funds, so the limits are enforced on-chain. Remove the agent and the
            funds are still safe.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
            {trust.map(([title, body]) => (
              <div key={title} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-6">
                <span className="font-semibold">{title}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{body}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* built on */}
      <section className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6">
          <SectionLabel>Built on X Layer</SectionLabel>
          <p className="max-w-2xl text-muted-foreground">
            USDT0 as the base asset, real yield through Aave on X Layer, and deposits that bridge in
            from Ethereum, Arbitrum, Optimism, and Polygon over LayerZero.
          </p>
          <div className="tnum flex flex-wrap items-center justify-center gap-x-8 gap-y-2 font-mono text-sm text-muted-foreground">
            <span>USDT0</span>
            <span className="text-border">·</span>
            <span>Aave</span>
            <span className="text-border">·</span>
            <span>LayerZero</span>
            <span className="text-border">·</span>
            <span>X Layer</span>
          </div>
        </div>
      </section>

      {/* closing */}
      <section className="relative isolate overflow-hidden">
        <LightBars />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center">
          <h2 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            The autonomous treasury for stablecoins.
          </h2>
          <Link href="/app" className={`${cta} bg-primary text-primary-foreground hover:opacity-90`}>
            Launch app
          </Link>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <AumoWordmark />
          <div className="flex items-center gap-5">
            <a className={footerLink} href="https://x.com/aumofinance" target="_blank" rel="noreferrer">X</a>
            <a className={footerLink} href="https://github.com/cryptoduke01/aumo" target="_blank" rel="noreferrer">GitHub</a>
            <span>© 2026 Aumo</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

const footerLink =
  "rounded-sm underline decoration-border underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}
