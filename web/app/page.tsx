import Link from "next/link";

const steps = [
  ["Deposit", "Fund the pool with USDT0 and receive shares. Your slice of everything the agent earns."],
  ["Sense", "The agent reads the live vault state and market data across allowlisted venues."],
  ["Score", "A risk engine haircuts each venue's yield by protocol, liquidity, peg, and utilization risk. It ranks on risk-adjusted yield, not headline APY."],
  ["Reason", "An LLM reads the market regime and can only make the plan more conservative. It never loosens a guardrail."],
  ["Prove", "Every move is capped on-chain, emits a receipt, and is recorded with the exact policy that governed it."],
];

const trust = [
  ["Guardrails live in the contract", "Per-move, per-venue, and global caps. Allowlisted venues only. The agent physically cannot exceed them."],
  ["It can never take your funds", "The agent only shuffles the pool between allowlisted venues and back. It cannot withdraw to any address."],
  ["Every decision is auditable", "A plain-language rationale per move, bound to a fingerprint of the policy in force, anchored by on-chain receipts."],
];

const cta =
  "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function Landing() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-primary" aria-hidden>▲</span>
          <span className="text-base font-semibold tracking-tight">Aumo</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link href="#how" className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:inline-block">
            How it works
          </Link>
          <Link href="/app" className={`${cta} bg-primary text-primary-foreground hover:opacity-90`}>
            Launch app
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 sm:py-24">
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Autonomous RWA-yield agent · X Layer
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
          Give a stablecoin <span className="text-primary">a job.</span>
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Deposit USDT0. An AI agent puts it to work in tokenized real-world-asset yield, rebalances
          on its own within on-chain guardrails, and proves every move. An agent you can hand money to.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/app" className={`${cta} bg-primary text-primary-foreground hover:opacity-90`}>
            Launch app
          </Link>
          <Link href="/app/vault" className={`${cta} border border-border hover:border-primary`}>
            Deposit USDT0
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border bg-card/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="mb-10 text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
            How it works
          </h2>
          <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
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

      {/* Trust */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="mb-3 text-2xl font-semibold tracking-tight">Control lives in the contract, not the agent.</h2>
          <p className="mb-10 max-w-2xl text-muted-foreground">
            Aumo moves real funds, so the limits are enforced on-chain. Remove the agent and the funds
            are still safe.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {trust.map(([title, body]) => (
              <div key={title} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
                <span className="font-semibold">{title}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{body}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Built on */}
      <section className="border-t border-border bg-card/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6">
          <h2 className="text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">Built on X Layer</h2>
          <p className="max-w-2xl text-muted-foreground">
            USDT0 as the base asset, real yield through Aave on X Layer, and deposits that bridge in
            from Ethereum, Arbitrum, Optimism, and Polygon over LayerZero.
          </p>
          <Link href="/app" className={`${cta} bg-primary text-primary-foreground hover:opacity-90`}>
            Open the app
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            <span className="text-primary" aria-hidden>▲</span> Aumo · autonomous treasury agent
          </span>
          <a
            href="https://github.com/cryptoduke01/aumo"
            target="_blank"
            rel="noreferrer"
            className="rounded-sm underline decoration-border underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
