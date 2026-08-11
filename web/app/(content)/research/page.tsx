import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research · Aumo",
  description:
    "Agentic reasoning for an autonomous treasury agent: how Aumo maps onto the foundational, self-evolving, and collective layers of agentic reasoning, and why it stays in-context by design.",
};

export default function ResearchPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="border-b border-border/70 py-16">
        <span className="text-xs uppercase tracking-[0.14em] text-accent">Research · 2026</span>
        <h1 className="mt-3 text-balance text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl">
          Agentic reasoning for an autonomous treasury agent
        </h1>
        <p className="mt-4 max-w-xl text-balance text-muted-foreground">
          How Aumo maps onto the foundational, self-evolving, and collective layers of agentic
          reasoning, and why a money-moving agent should stay in-context by design.
        </p>

        {/* byline */}
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
      </header>

      <article className="prose py-14">
        <h2>Abstract</h2>
        <p className="lead">
          Aumo is an autonomous agent that puts idle stablecoins to work in the best risk-adjusted
          on-chain yield, inside guardrails enforced by a contract. This note maps its architecture
          onto the three layers of agentic reasoning, foundational, self-evolving, and collective,
          and argues that for an agent moving real money, deterministic and auditable in-context
          orchestration is the right stance, not learned weights. Every claim here points at code.
        </p>

        <h2 id="loop">The reasoning loop</h2>
        <p>
          The canonical financial-agent loop is assess, plan, simulate, execute, review. Aumo runs
          exactly that, named for what a depositor cares about: <strong>sense, score, reason, act,
          prove</strong>. The load-bearing word is <em>simulate</em>. Aumo does not commit a plan on
          today&apos;s numbers alone; it projects the portfolio the plan would create and
          stress-tests it first, a step most yield strategies quietly skip.
        </p>

        <h2 id="foundational">Foundational: planning, tools, search</h2>
        <p>
          Planning is deterministic and guardrail-satisfying by construction: the planner can only
          propose moves that already satisfy every on-chain cap, so the contract never has to reject
          a well-formed plan. Tool use is on-chain, the agent reads live vault and venue state and
          writes allocations through typed contract calls, and the risk engine is a tool that
          decomposes each venue into protocol, liquidity, peg, utilization, and concentration risk.
          Search is ranking by risk-adjusted yield rather than headline APY.
        </p>

        <h2 id="self-evolving">Self-evolving: memory, feedback, improvement</h2>
        <p>
          This is where Aumo invests, and it maps one to one onto the layer&apos;s named techniques.
        </p>
        <ul>
          <li>
            <strong>In-context memory.</strong> Prior receipts are replayed into per-venue history,
            and a momentum signal turns that history into an adverse-trend penalty. A venue at 70%
            utilization that climbed from 45% in three cycles is scored riskier than one that has
            been flat, because the trend, not just the level, is the tell.
          </li>
          <li>
            <strong>Simulation.</strong> The scenario engine applies plausible shocks, a liquidity
            crunch, an RWA peg shock, a lending utilization spike, to the plan&apos;s projected
            portfolio and denies any venue a shock would strand.
          </li>
          <li>
            <strong>Reflection.</strong> The agent grades its own past trend calls: when momentum
            flagged a venue, did that venue actually keep deteriorating? A predictive record raises
            how much the momentum penalty bites; a mixed one holds steady. It is strictly
            tighten-only, so a reflective Aumo can only become more cautious, never talk itself into
            loosening.
          </li>
        </ul>

        <h2 id="collective">Collective: a planner and a critic</h2>
        <p>
          Aumo is single-agent today, but it already runs a planner-versus-critic split, the seed of
          the collective layer. The critic is an adversarial gate that runs after the planner and the
          reasoning layer and asks how this specific plan could lose money from angles the ranking
          misses: adding to a deteriorating venue, taking too large a share of one venue&apos;s exit
          liquidity, or leaving too thin an idle buffer. It can veto allocations or escalate a doubt
          that holds the cycle, and like everything else it can only ever remove risk. The natural
          next step is more roles: a peg watcher, a liquidity analyst, a macro-regime agent, each
          contributing a view.
        </p>

        <h2 id="in-context">In-context, on purpose</h2>
        <p>
          Under the in-context orchestration versus post-training split, Aumo sits entirely on the
          in-context side, and this is deliberate. For an agent that moves real money, deterministic,
          auditable guardrails written in code beat opaque learned weights. The safety is provable
          rather than trained in: the reasoning layer is a second opinion that can only tighten, and
          every guardrail is re-enforced by the contract after the model answers. That is a design
          choice, not a gap.
        </p>

        <h2 id="evaluation">Evaluation</h2>
        <p>
          A backtest replays a synthetic market, a hot venue that deteriorates over cycles and then
          breaks, through Aumo&apos;s real engine and, side by side, a naive highest-APY chaser on the
          identical market. Aumo captures the early yield, then temporal awareness and rising risk
          push the venue past appetite and it exits before the break. It ends roughly 27% ahead with
          about 21 points less drawdown, while the chaser walks into the break and eats the haircut.
          The harness is deterministic on purpose: the reasoning layer only tightens, so proving the
          core is the honest floor.
        </p>

        <h2 id="proof">Every move is a receipt</h2>
        <p>
          Review is the close of the loop. Each cycle writes a receipt: the inputs seen, the risk
          scores, the stress result, the reflection, the critic&apos;s verdict, the plan, and the
          resulting transaction hashes, bound to a fingerprint of the exact policy in force. The
          chain holds the receipts; the reasoning is anchored to them.
        </p>

        <hr />
        <p className="text-sm text-faint">
          Framework after the survey <em>Agentic Reasoning for Large Language Models</em>. Written by
          Duke (<a href="https://x.com/dukedotsol" target="_blank" rel="noreferrer">@dukedotsol</a>).
          Companion to the Aumo <a href="/whitepaper">whitepaper</a> and <a href="/docs">docs</a>.
        </p>
      </article>
    </div>
  );
}
