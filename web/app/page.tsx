import { AsciiField } from "@/components/ascii-field";
import { AgentConsole } from "@/components/agent-console";
import { Grain } from "@/components/grain";
import { Orb } from "@/components/orb";
import { AumoMark } from "@/components/mark";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

function ArrowOut({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M5 11L11 5M11 5H6M11 5V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cta({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <a
      href="https://app.aumo.finance"
      className={`chamfer group inline-flex items-center gap-2 bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] ${className}`}
      style={{ ["--cut" as string]: "10px" }}
    >
      {children ?? "Launch app"}
      <ArrowOut className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  );
}

// A still, non-interactive mirror of the in-app Ask Aumo panel. It shows what
// talking to the agent looks like without spending a live model call on every
// landing visit. The real, live version lives behind the app.
function AskPreview() {
  return (
    <div className="chamfer-edge w-full">
      <div className="chamfer bg-card">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="relative inline-flex size-8 items-center justify-center">
            <Orb className="size-8 text-primary/30" />
            <AumoMark className="absolute size-3.5 text-primary" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-none">Ask Aumo</span>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" /> Agent online
            </span>
          </div>
        </div>

        {/* thread */}
        <div className="flex flex-col gap-4 px-5 py-6">
          <div className="flex justify-end">
            <p className="max-w-[80%] rounded-lg rounded-br-sm bg-surface-2 px-3.5 py-2 text-sm text-foreground">
              Why did you move into USDG?
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <AumoMark className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="max-w-[85%] text-sm leading-relaxed text-foreground/90">
              USDG scored highest on risk-adjusted yield this cycle. It&apos;s backed by cash and
              short-term Treasuries, so its peg and liquidity haircuts are small. I capped the move
              at the per-venue limit and left the rest in Aave to stay diversified.
            </p>
          </div>
        </div>

        {/* input (visual only) */}
        <div className="flex items-center gap-2 border-t border-border p-2.5">
          <div className="min-w-0 flex-1 px-2 py-2 text-sm text-faint">Ask the agent anything…</div>
          <span
            className="chamfer inline-flex items-center bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            style={{ ["--cut" as string]: "8px" }}
          >
            Ask
          </span>
        </div>
      </div>
    </div>
  );
}

const CYCLE: [string, string][] = [
  ["Sense", "Read live vault state and every allowlisted venue."],
  ["Score", "Haircut each yield by liquidity, peg, utilization and correlation."],
  ["Reason", "The model reads the regime and can only tighten, never loosen."],
  ["Act", "Move within per-move and per-venue caps written into the contract."],
  ["Prove", "Emit a receipt bound to a fingerprint of the exact policy in force."],
];

const GUARANTEES: [string, string][] = [
  ["Caps live in the contract", "Per-move and per-venue limits are enforced on-chain. The agent physically cannot exceed them."],
  ["It cannot take your funds", "The agent only shuffles between allowlisted venues and back. There is no withdrawal path to any outside address."],
  ["Every move is provable", "A plain-language rationale, bound to a fingerprint of the governing policy, anchored by an on-chain receipt."],
];

export default function Landing() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      {/* ── hero ────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden">
        <AsciiField className="opacity-60 [mask-image:radial-gradient(120%_80%_at_50%_0%,#000_15%,transparent_72%)]" />
        <Grain />
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-5 pt-20 pb-16 text-center sm:px-8 sm:pt-28">
          <h1 className="max-w-3xl text-balance text-[2.7rem] font-medium leading-[1.03] tracking-[-0.02em] sm:text-6xl">
            Put your stablecoins to work.
          </h1>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Aumo is an autonomous treasury agent. It moves your idle USDT0 into
            the best risk-adjusted yield on X Layer, across on-chain lending and
            real-world-asset-backed dollars, inside guardrails it can&apos;t break.
          </p>
          <Cta className="mt-8" />

          <div className="mt-16 w-full max-w-3xl sm:mt-20">
            <AgentConsole />
          </div>
        </div>
      </section>

      {/* ── talk to the agent (two-up: copy + live product preview) ─ */}
      <section className="relative isolate overflow-hidden border-t border-border/70">
        <AsciiField className="opacity-30 [mask-image:radial-gradient(120%_100%_at_80%_40%,#000_10%,transparent_70%)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-[62%] top-1/2 size-[38rem] -translate-y-1/2 rounded-full opacity-[0.08] blur-2xl"
          style={{ background: "radial-gradient(circle, var(--primary) 0%, transparent 62%)" }}
        />
        <Grain />
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
          {/* left: copy + CTA */}
          <div className="flex flex-col">
            <span className="inline-flex items-center gap-2 self-start rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-accent">
              <span className="size-1.5 rounded-full bg-accent" /> Live agent
            </span>
            <h2 className="mt-5 text-balance text-3xl font-medium leading-[1.05] tracking-tight sm:text-4xl">
              Talk to the agent.
            </h2>
            <p className="mt-4 max-w-md text-balance text-muted-foreground">
              It can explain any move it made, how it scored a venue, and what would turn it
              defensive, in plain language, from its own live state. No dashboards to decode.
            </p>
            <Cta className="mt-8 self-start">Talk to Aumo</Cta>
          </div>

          {/* right: a still preview of Ask Aumo (honest mirror of the real thing) */}
          <AskPreview />
        </div>
      </section>

      {/* ── one cycle ───────────────────────────────────────── */}
      <section id="cycle" className="border-t border-border/70">
        <div className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-8">
          <h2 className="max-w-xl text-balance text-2xl font-medium tracking-tight sm:text-3xl">
            One cycle, start to proof.
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            The same five steps run every rebalance. Nothing happens off-chain
            that the receipt can&apos;t show.
          </p>

          <ol className="mt-14 flex flex-col gap-10 md:flex-row md:gap-0">
            {CYCLE.map(([verb, body], i) => (
              <li key={verb} className="relative flex-1 md:px-6 md:first:pl-0 md:last:pr-0">
                {i > 0 && (
                  <span
                    aria-hidden
                    className="absolute -left-px top-1.5 hidden h-2.5 w-px rounded-full bg-accent md:block"
                  />
                )}
                <div className="flex items-baseline gap-3">
                  <span className="text-sm font-medium text-accent">{verb}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── trust ───────────────────────────────────────────── */}
      <section id="trust" className="border-t border-border/70 bg-surface/40">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-x-16 gap-y-10 px-5 py-24 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="text-balance text-2xl font-medium tracking-tight sm:text-3xl">
              Control lives in the contract, not the agent.
            </h2>
            <p className="mt-4 max-w-sm text-muted-foreground">
              Aumo moves real money, so the limits are enforced where they
              can&apos;t be argued with. Take the agent away and the funds stay
              exactly as safe.
            </p>
          </div>
          <dl className="flex flex-col">
            {GUARANTEES.map(([title, body], i) => (
              <div
                key={title}
                className={`grid grid-cols-1 gap-1 py-5 sm:grid-cols-[0.9fr_1.1fr] sm:gap-8 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <dt className="font-medium text-foreground">{title}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── closing ─────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden border-t border-border/70">
        <Grain />
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 py-24 text-center sm:px-8">
          <h2 className="max-w-xl text-balance text-3xl font-medium tracking-tight sm:text-4xl">
            The autonomous treasury for stablecoins.
          </h2>
          <Cta className="mt-8" />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
