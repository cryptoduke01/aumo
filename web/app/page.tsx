import { AsciiField } from "@/components/ascii-field";
import { DitherBg } from "@/components/dither-bg";
import { DitherField } from "@/components/dither-field";
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

      {/* ── hero: the living dither field, blooming below the headline over ink ── */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {/* generative Sovereign field — dense core pushed low so it blooms under the CTA and the
              headline sits on near-ink; dialed down so it never fights the type */}
          <DitherField
            coreY={0.82}
            intensity={0.6}
            className="[mask-image:linear-gradient(to_bottom,transparent_0%,#000_34%,#000_78%,transparent_100%)]"
          />
          {/* warm Sovereign glow bleeding THROUGH the field (keryx model) */}
          <div
            className="absolute inset-0 mix-blend-soft-light"
            style={{ background: "radial-gradient(60% 50% at 50% 74%, color-mix(in srgb, var(--primary) 40%, transparent), transparent 64%)" }}
          />
          {/* ink scrim behind the text column so the headline + subhead stay fully legible */}
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(66% 52% at 50% 34%, var(--background) 0%, color-mix(in srgb, var(--background) 82%, transparent) 40%, transparent 72%)" }}
          />
          {/* fade the field into the Ink page top and bottom */}
          <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
        </div>
        <Grain />
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-5 pt-32 pb-24 text-center sm:px-8 sm:pt-44 sm:pb-32">
          <h1 className="max-w-3xl text-balance text-[2.9rem] font-medium leading-[1.02] tracking-[-0.02em] sm:text-7xl">
            Put your stablecoins to work.
          </h1>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Aumo is an AI agent that moves idle USDT0 into the best risk-adjusted yield on X Layer,
            on-chain lending and a Treasury-backed dollar, inside guardrails it can&apos;t break.
          </p>
          <Cta className="mt-9" />
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
            <h2 className="text-balance text-3xl font-medium leading-[1.05] tracking-tight sm:text-4xl">
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
      <section id="cycle" className="relative isolate overflow-hidden border-t border-border/70">
        <DitherBg src="/dither-images/HMtauliaQAAqwjB.jpeg" from="bottom" opacity={0.14} glow={false} />
        <div className="relative mx-auto w-full max-w-6xl px-5 py-24 sm:px-8">
          <h2 className="max-w-xl text-balance text-2xl font-medium tracking-tight sm:text-3xl">
            One cycle, start to proof.
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            The same five steps run every rebalance. Nothing happens off-chain
            that the receipt can&apos;t show.
          </p>

          <ol className="mt-14 flex flex-col gap-10 md:flex-row md:items-start md:gap-0">
            {CYCLE.map(([verb, body], i) => (
              <li key={verb} className="relative flex-1 md:px-6 md:first:pl-0 md:last:pr-0">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="relative flex size-2 shrink-0">
                    <span className="size-2 rounded-full bg-accent" />
                    <span className="cycle-ping absolute inset-0 rounded-full bg-accent" />
                  </span>
                  <span className="text-sm font-medium text-accent">{verb}</span>
                  {/* flowing connector: a gold dash travels toward the next step, staggered so the
                      whole cycle reads left to right */}
                  {i < CYCLE.length - 1 && (
                    <span aria-hidden className="relative hidden h-px flex-1 overflow-hidden bg-border md:block">
                      <span
                        className="cycle-flow absolute top-0 h-px w-7 bg-accent"
                        style={{ animationDelay: `${i * 0.38}s` }}
                      />
                    </span>
                  )}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:pr-6">{body}</p>
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
        <DitherBg src="/dither-images/HMxjjf9awAA2faD.jpeg" from="center" opacity={0.28} />
        <Grain />
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 py-28 text-center sm:px-8">
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
