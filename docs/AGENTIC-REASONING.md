# Aumo and the agentic-reasoning taxonomy

A one-page map of Aumo's architecture onto the survey *Agentic Reasoning for Large Language Models*
(Foundational, Self-evolving, Collective; in-context orchestration vs post-training). Every claim
below points at code you can read.

## The loop

The survey's canonical financial-agent loop is Assess, Plan, Simulate, Execute, Review. Aumo runs
exactly that, named for what a depositor cares about:

> Sense, Score, Reason, Act, Prove.

The important word is **Simulate**. Aumo does not commit a plan on today's numbers alone; it projects
the portfolio the plan would create and stress-tests it first. That maps to the survey's Simulate
stage and is where a lot of yield strategies quietly skip a step.

## Layer 1: Foundational (planning, tool use, search)

- **Planning** is deterministic and guardrail-satisfying by construction: `brain/plan.ts` only ever
  proposes moves that already satisfy every on-chain cap, so the contract never has to reject a
  well-formed plan.
- **Tool use** is on-chain: the agent reads live vault and venue state and writes `allocate` /
  `deallocate` through typed contract calls (`chain/`), and the risk engine (`risk/engine.ts`) is a
  tool that decomposes each venue into protocol, liquidity, peg, utilization and concentration risk.
- **Search** is ranking by risk-adjusted yield, not headline APY.

## Layer 2: Self-evolving (memory, feedback, continuous improvement)

This is where Aumo invests, and it maps one to one to the survey's named techniques.

- **In-context memory (rolling history).** Prior receipts are replayed into per-venue history, and
  `risk/momentum.ts` turns that history into an adverse-trend signal. A venue at 70% utilization that
  climbed from 45% in three cycles is scored riskier than one that has been flat, because the trend,
  not just the level, is the tell.
- **Simulation / iterative refinement.** `risk/stress.ts` applies plausible shocks (a liquidity
  crunch, an RWA peg shock, a lending utilization spike) to the plan's projected portfolio and denies
  any venue a shock would strand.
- **Reflection / experience replay.** `brain/reflect.ts` grades the agent's own past trend calls:
  when momentum flagged a venue, did that venue actually keep deteriorating? A predictive track record
  raises how much the momentum penalty bites; a mixed one holds steady. It is strictly tighten-only,
  so a reflective Aumo can only become more cautious, never talk itself into loosening.

The proof that this works is a backtest (`scripts/backtest.ts`, `npm run backtest`): on a market where
a hot venue deteriorates and then breaks, Aumo's engine captures the early yield, exits before the
break, and ends about 27% ahead of a naive highest-APY chaser with roughly 21 points less drawdown.

## Layer 3: Collective (multi-agent roles)

Aumo is single-agent today, but it already runs a planner-versus-critic split, the seed of the
Collective layer. `brain/critic.ts` is an adversarial gate that runs after the planner and the LLM
and asks how this specific plan could lose money from angles the ranking misses: adding to a
deteriorating venue, taking too large a share of one venue's exit liquidity, or leaving too thin an
idle buffer. It can veto allocations or escalate a doubt that holds the cycle, and like everything
else it can only ever remove risk. The natural next step is more roles: a peg watcher, a liquidity
analyst, a macro-regime agent, each contributing a view.

## In-context, on purpose

Under the survey's in-context orchestration versus post-training (RL/SFT) split, Aumo sits entirely on
the in-context side, and this is deliberate. For an agent that moves real money, deterministic,
auditable guardrails written in code beat opaque learned weights. The safety is provable rather than
trained in: the reasoning layer is a second opinion that can only tighten, and every guardrail is
re-enforced by the contract after the model answers. That is a design choice, not a gap.

## Every move is a receipt

Assess, Plan, Simulate, Execute, Review closes with Review. Each cycle writes a receipt: the inputs
seen, the risk scores, the stress result, the reflection, the critic's verdict, the plan, and the
resulting transaction hashes, bound to a fingerprint of the exact policy in force. The chain holds the
receipts; the reasoning is anchored to them.
