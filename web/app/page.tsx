import { AsciiField } from "@/components/ascii-field";
import { AgentConsole } from "@/components/agent-console";
import { Grain } from "@/components/grain";
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
      className={`chamfer group inline-flex items-center gap-2 bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 ${className}`}
      style={{ ["--cut" as string]: "10px" }}
    >
      {children ?? "Launch app"}
      <ArrowOut className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
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
            real-world-asset yield, stays inside guardrails it can&apos;t break,
            and proves every move on-chain.
          </p>
          <Cta className="mt-8" />

          <div className="mt-16 w-full max-w-3xl sm:mt-20">
            <AgentConsole />
          </div>
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
