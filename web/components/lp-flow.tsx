"use client";

import { useState } from "react";

// An informal, click-through walkthrough of how the agent provides liquidity. No live position yet
// (the agent funds it only when the yield beats holding), so this shows the mechanism itself, step by
// step, with a toy $100 example.
const STEPS: { title: string; body: string; flow: string }[] = [
  {
    title: "The agent decides it's worth it",
    body: "Nothing happens until providing liquidity actually pays. The agent scores this venue every cycle and only funds it when its risk-adjusted yield beats the alternatives. So most of the time this sits at $0 on purpose. That's the whole point of a picky agent.",
    flow: "score venue  →  worth funding?  →  go",
  },
  {
    title: "It splits your deposit in half",
    body: "To provide liquidity you need both sides of the pair. So it swaps half your USDT0 into USDG, behind a slippage floor. If the pool is thin or someone's messing with the price, the swap just reverts instead of bleeding you.",
    flow: "$100 USDT0  →  $50 USDG + $50 USDT0",
  },
  {
    title: "It mints full-range liquidity",
    body: "Now it drops that USDG and USDT0 into the real Uniswap v3 pool across the entire price range. Full-range means the position is always active and never needs babysitting or rebalancing, which for two dollar-pegged coins is exactly what you want.",
    flow: "$50 USDG + $50 USDT0  →  LP position",
  },
  {
    title: "The pool pays it fees",
    body: "Every trade through that pool pays a 0.01% fee, split across everyone providing liquidity. Your slice piles up on the position as owed tokens. There's no claim button and no separate vault: it just compounds straight into your share value.",
    flow: "each swap  →  0.01% fee  →  your slice",
  },
  {
    title: "On exit, it unwinds and swaps back",
    body: "When the agent wants out (or you withdraw), it burns the position, sweeps up the fees, swaps the USDG leg back to USDT0, and returns it all to the pool. Same machinery, in reverse. Withdraw a little and it only unwinds a proportional slice.",
    flow: "burn + collect  →  swap to USDT0  →  back to the pool",
  },
];

export function LpFlow() {
  const [i, setI] = useState(0);
  const s = STEPS[i]!;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      {/* step dots */}
      <div className="flex flex-wrap gap-1.5">
        {STEPS.map((st, j) => (
          <button
            key={j}
            onClick={() => setI(j)}
            aria-label={`Step ${j + 1}: ${st.title}`}
            className={`flex size-7 items-center justify-center rounded-md text-xs font-medium tnum transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              j === i
                ? "bg-accent text-black"
                : j < i
                  ? "bg-card-2 text-accent"
                  : "bg-card-2 text-muted-foreground hover:text-foreground"
            }`}
          >
            {j + 1}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-faint">
          step {i + 1} of {STEPS.length}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-base font-medium text-foreground">{s.title}</h4>
        <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
      </div>

      <div className="rounded-lg border border-border bg-card-2 px-4 py-3">
        <span className="font-mono text-[13px] text-accent">{s.flow}</span>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => setI(Math.max(0, i - 1))}
          disabled={i === 0}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          Back
        </button>
        <button
          onClick={() => setI(Math.min(STEPS.length - 1, i + 1))}
          disabled={i === STEPS.length - 1}
          className="rounded-lg border border-accent/40 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {i === STEPS.length - 1 ? "That's it" : "Next"}
        </button>
      </div>
    </div>
  );
}
