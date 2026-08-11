import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research · Aumo",
  description:
    "A guardrailed, self-evolving reasoning agent for autonomous stablecoin treasury management: the risk model, temporal awareness, scenario simulation, reflection, an adversarial critic, and a deterministic backtest.",
};

function Eq({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-border bg-surface-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground">
      {children}
    </div>
  );
}

export default function ResearchPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="border-b border-border/70 py-16">
        <span className="text-xs uppercase tracking-[0.14em] text-accent">
          Research · Aumo Labs · August 2026
        </span>
        <h1 className="mt-3 text-balance text-4xl font-medium leading-[1.05] tracking-tight sm:text-[2.9rem]">
          A guardrailed, self-evolving reasoning agent for autonomous stablecoin treasury management
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
          <span className="text-[11px] uppercase tracking-[0.14em] text-faint">Abstract</span>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Autonomous yield agents that maximize headline APY are fragile: they concentrate into the
            highest-paying venue precisely as it deteriorates, and take the loss when it breaks. We
            present Aumo, a treasury agent that manages a pooled ERC-4626 vault of stablecoins under
            guardrails enforced on-chain. Aumo decomposes venue risk into five bounded sub-scores,
            augments them with a temporal (momentum) signal derived from its own recorded history,
            stress-tests every candidate allocation against adverse scenarios before committing, grades
            its past predictions to self-calibrate, and passes a final plan through an adversarial
            critic that can veto or hold. A large-language-model layer sits on top as a second opinion
            constrained to a formal <em>tighten-only</em> property: it can make the plan more
            conservative but never looser, and every guardrail is re-enforced by the contract after it
            answers. On a deterministic backtest in which a high-yield venue rots and then breaks,
            Aumo exits before the break and ends 27% ahead of a naive yield-chaser with 21 points less
            drawdown. We argue that for an agent moving real funds, in-context orchestration with
            auditable guardrails is preferable to post-trained policy.
          </p>
          <p className="mt-3 text-[11px] text-faint">
            <span className="text-muted-foreground">Keywords:</span> autonomous agents, agentic
            reasoning, DeFi, risk-adjusted yield, real-world assets, temporal awareness, scenario
            simulation, self-reflection, tighten-only safety.
          </p>
        </div>
      </header>

      <article className="prose py-14">
        <h2 id="s1">1. Introduction</h2>
        <p>
          Idle stablecoins are a solved problem in theory and an unsolved one in practice. Depositors
          want yield without becoming full-time risk managers, and the market punishes the naive
          strategy: chasing the highest advertised rate concentrates capital into the venue most under
          stress, which is often paying up precisely because liquidity is fleeing it. When it breaks,
          the chaser is fully exposed.
        </p>
        <p>
          Aumo is an agent that manages a shared vault of stablecoins on X Layer and allocates the
          pooled balance across allowlisted venues to the best <em>risk-adjusted</em> yield, inside
          limits written into a contract. This paper documents its reasoning architecture and states
          the safety property that makes an autonomous money-moving agent defensible. Our contributions
          are: (i) a bounded, explainable risk model with a temporal component learned from the
          agent&apos;s own history; (ii) a scenario-simulation stage that refuses allocations a
          plausible shock would trap; (iii) a self-reflection loop that recalibrates trust in its
          signals under a monotonic safety bound; (iv) an adversarial critic as a final gate; and (v) a
          formal tighten-only guarantee that survives an unreliable or adversarial model.
        </p>

        <h2 id="s2">2. Background: the reasoning taxonomy</h2>
        <p>
          Recent surveys organize agentic reasoning into three layers: <strong>foundational</strong>{" "}
          (planning, tool use, search), <strong>self-evolving</strong> (memory, reflection, iterative
          refinement), and <strong>collective</strong> (multi-agent roles), and distinguish{" "}
          <em>in-context orchestration</em> from <em>post-training</em> (RL/SFT). We use this frame to
          situate Aumo and to justify a deliberate choice: Aumo is entirely in-context. Its safety is a
          property of code, not of learned weights.
        </p>

        <h2 id="s3">3. System overview</h2>
        <p>
          Each cycle runs five stages, sense, score, simulate, reason, act, and closes with a proof.
          The planner is deterministic and constructs only moves that already satisfy every on-chain
          cap, so the contract never rejects a well-formed plan. Formally, let{" "}
          <code>P₀</code> be the deterministic plan and <code>T</code> any transform applied by a later
          stage (LLM, stress, critic). Every <code>T</code> in Aumo satisfies
        </p>
        <Eq>risk(T(P)) ≥ risk(P) and deploy(T(P)) ⊆ deploy(P)</Eq>
        <p>
          that is, later stages may only raise caution or remove deployments. We call this the{" "}
          <strong>tighten-only</strong> property. It is what lets an unreliable model participate
          safely: the worst a bad answer can do is make the vault more conservative or be discarded.
        </p>

        <h2 id="s4">4. The risk model</h2>
        <p>
          For each venue <code>v</code> the engine computes five bounded sub-scores in{" "}
          <code>[0,1]</code>: protocol risk (curated base), liquidity risk (venue depth blended with
          our own exit capacity), peg risk (deviation from par, with a conservative floor for
          unmonitored real-world-asset venues), utilization risk (lending only), and a
          correlation-aware concentration risk. They combine as a fixed weighted blend:
        </p>
        <Eq>
          risk(v) = clamp₀₁( 0.30·protocol + 0.25·liquidity + 0.20·peg + 0.15·utilization +
          0.10·concentration + 0.15·κ·momentum(v) )
        </Eq>
        <p>
          Concentration is correlation-aware: exposure to a venue plus everything correlated with it,
          using a same-kind correlation of 0.75 and a cross-kind correlation of 0.20, so diversifying
          across uncorrelated kinds genuinely lowers risk while splitting across correlated ones does
          not. The score maps to a band, <code>low &lt; 0.25 ≤ moderate &lt; 0.50 ≤ elevated &lt; 0.75
          ≤ high</code>, and the headline APY is haircut into the quantity the allocator actually ranks
          on:
        </p>
        <Eq>riskAdjustedAPY(v) = APY(v) · (1 − risk(v))</Eq>

        <h2 id="s5">5. Temporal awareness</h2>
        <p>
          Levels are blind to trajectory. A venue at 70% utilization that has been flat is not the same
          as one that climbed from 45% in three cycles. Aumo replays its own recorded history and, for
          each venue, compares the current sample to a rolling window mean, forming an{" "}
          <em>adverse-only</em> momentum score:
        </p>
        <Eq>
          momentum(v) = clamp₀₁( 0.4·utilRise + 0.3·pegWiden + 0.2·depthDrop + 0.1·apySpike )
        </Eq>
        <p>
          where each term is the positive part of the relevant change, normalized by the move that
          saturates it (a 20-point utilization rise, a 100 bps peg widening, a 30-point drop in the
          liquidity-to-TVL ratio, a 5% APY spike). Favourable trends contribute nothing, so momentum
          can only raise risk, and it enters the blend as the additive penalty above with weight 0.15.
        </p>

        <h2 id="s6">6. Scenario simulation</h2>
        <p>
          Before committing, Aumo projects the portfolio the plan would create and applies a set of
          plausible shocks: a 50% collapse in exit liquidity, a 150 bps peg shock to real-world-asset
          venues, and a lending utilization spike to 95%. A venue is <em>fragile</em> if a shock pushes
          a held position into the top risk band or makes it exceed all withdrawable liquidity (an
          un-exitable trap). Fragile venues are denied new deploys, and the fraction of scenarios that
          breach drives a regime ceiling:
        </p>
        <Eq>
          fragility = breachedScenarios / totalScenarios &nbsp;→&nbsp; regime = fragility &gt; 0.66 ?
          defensive : fragility &gt; 0.33 ? cautious : calm
        </Eq>

        <h2 id="s7">7. Reflection and self-calibration</h2>
        <p>
          Aumo grades its own past trend calls. Replaying the history, when momentum flagged a venue,
          did that venue actually keep deteriorating the next cycle? Let <code>hitRate</code> be the
          fraction of flags followed by continued deterioration. The agent then scales how much
          momentum bites:
        </p>
        <Eq>κ = 1 + 0.5 · hitRate ∈ [1, 1.5]</Eq>
        <p>
          Because <code>κ ≥ 1</code> always, reflection is tighten-only by construction: a predictive
          track record makes the agent more cautious, a poor one leaves it unchanged, and it can never
          use hindsight to loosen. The reflection is written into the receipt as experience replay.
        </p>

        <h2 id="s8">8. The adversarial critic</h2>
        <p>
          After the planner and the model, a distinct critic asks not &quot;is this venue
          acceptable?&quot; but &quot;how could this specific plan lose money?&quot; It refuses to add
          to a venue whose momentum exceeds 0.5, refuses a position that would exceed 25% of a
          venue&apos;s exit liquidity, and escalates a <em>doubt</em> that holds the entire cycle if
          the plan would leave the pool under a 5% idle buffer. It can only remove allocations or hold;
          de-risking is never blocked. This is the seed of the collective layer: a planner and a
          skeptic as separate roles.
        </p>

        <h2 id="s9">9. Collective risk steering</h2>
        <p>
          Depositors declare an appetite tier on-chain (conservative, moderate, bold). Because a single
          pooled vault has one allocation, individual per-user risk is impossible; instead the agent
          share-weights everyone&apos;s tier and clamps the result to the owner&apos;s hard ceiling:
        </p>
        <Eq>effectiveAppetite = min( shareWeightedTier(depositors), ownerCeiling )</Eq>
        <p>
          So depositors can collectively steer the pool safer, or up to but never past, the on-chain
          hard bound. The preference is a pure signal: it never moves funds or relaxes a cap.
        </p>

        <h2 id="s10">10. Evaluation</h2>
        <p>
          We replay a synthetic market of 30 cycles through Aumo&apos;s real deterministic engine and,
          side by side, a naive highest-APY strategy on the identical market. A hot venue looks
          attractive early (12% APY), then deteriorates over cycles (utilization climbs to 97%, exit
          liquidity thins, base risk rises) and breaks at cycle 20, haircutting anyone still inside by
          35%. The harness is deterministic on purpose: the model only tightens, so proving the core is
          the honest floor.
        </p>
        <div className="my-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Strategy</th>
                <th className="py-2 pr-4 font-medium">Final value</th>
                <th className="py-2 pr-4 font-medium">Max drawdown</th>
                <th className="py-2 font-medium">Exposure at break</th>
              </tr>
            </thead>
            <tbody className="tnum">
              <tr className="border-b border-border/60">
                <td className="py-2 pr-4 text-foreground">Aumo (levels + momentum + stress)</td>
                <td className="py-2 pr-4 text-accent">$10,384</td>
                <td className="py-2 pr-4">0.0%</td>
                <td className="py-2">$0</td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-foreground">Naive (chase highest APY)</td>
                <td className="py-2 pr-4">$8,175</td>
                <td className="py-2 pr-4">21.4%</td>
                <td className="py-2">$6,334</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Aumo captures the early yield, then temporal awareness and rising base risk push the venue
          past appetite and it exits before the break, ending about 27% ahead with roughly 21 points
          less drawdown and zero exposure at the break. The naive strategy chases the rate into the
          wall. The harness is reproducible with a single command.
        </p>

        <h2 id="s11">11. Design rationale: in-context, on purpose</h2>
        <p>
          Aumo could be post-trained on historical allocations. We deliberately do not. For an agent
          that moves real money, deterministic, auditable guardrails beat opaque learned weights: the
          tighten-only property (Section 3) is a theorem about the code, not a hope about a policy, and
          every constraint is re-checked by the contract after the model answers. A regulator, a
          depositor, or an auditor can read exactly why any move was made. That legibility is the
          product, not an afterthought.
        </p>

        <h2 id="s12">12. Limitations</h2>
        <ul>
          <li>
            <strong>Pooled allocation.</strong> A single vault has one allocation, so risk steering is
            collective and share-weighted, not per-depositor. Dissenting depositors can exit but cannot
            hold a different allocation within the same pool.
          </li>
          <li>
            <strong>Synthetic evaluation.</strong> The backtest uses a constructed market to isolate
            the deteriorate-then-break failure mode. It demonstrates the mechanism; it is not a claim
            about realized returns on any live venue.
          </li>
          <li>
            <strong>Single agent.</strong> The critic is one adversarial role. Richer collective
            reasoning (a peg watcher, a liquidity analyst, a macro-regime agent) is future work.
          </li>
          <li>
            <strong>Audit status.</strong> The contracts are hardened and internally reviewed but have
            not completed a formal third-party audit. Conservative caps apply.
          </li>
        </ul>

        <h2 id="s13">13. Conclusion</h2>
        <p>
          An autonomous treasury agent does not have to choose between yield and trust. By ranking on
          risk-adjusted yield, reading trajectory rather than level, simulating shocks before it
          commits, grading its own predictions under a monotonic safety bound, and gating everything
          behind an adversarial critic and an on-chain contract, Aumo puts stablecoins to work while
          keeping every move provable. The reasoning is sophisticated; the safety is simple, because it
          lives in code.
        </p>

        <hr />
        <p className="text-sm text-faint">
          Framework after the survey <em>Agentic Reasoning for Large Language Models</em> (2026).
          Implementation references: the risk engine, momentum, stress, reflection, and critic modules
          in the Aumo agent, and the ERC-4626 pool contract. Companion to the Aumo{" "}
          <a href="/whitepaper">whitepaper</a> and <a href="/docs">docs</a>. Written by Duke (
          <a href="https://x.com/dukedotsol" target="_blank" rel="noreferrer">
            @dukedotsol
          </a>
          ).
        </p>
      </article>
    </div>
  );
}
