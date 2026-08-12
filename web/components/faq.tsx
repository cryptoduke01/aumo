// Landing FAQ. Native <details> accordions: accessible, no JS, and great for SEO (the questions are
// exactly what a cautious depositor searches). Answers are honest, never over-promising returns.

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Aumo?",
    a: "An autonomous treasury for stablecoins on X Layer. You deposit USDT0, and an AI agent puts it to work in real-world-asset and lending yield, preservation first, inside limits enforced on-chain that it cannot break. Every move is provable.",
  },
  {
    q: "Can Aumo take my funds?",
    a: "No. The agent can only shuffle funds between allowlisted venues and back. There is no path to withdraw to any outside address, and the caps are enforced by the contract, not the agent. Its signing key is held in a secure enclave and restricted to two actions.",
  },
  {
    q: "Where does the yield come from?",
    a: "Real income, not speculation. USDT0 keeps its dollar peg, so the return is the interest the venues pay: on-chain lending yield on Aave, the yield on USDG (a Treasury-backed dollar), and Pendle fixed yield.",
  },
  {
    q: "Is this real-world-asset (RWA) yield?",
    a: "Yes. USDG is a regulated dollar backed by cash and short-term US Treasuries, so allocating into it is real-world-asset exposure, and Aumo also buys Pendle PT-USDG for a fixed, defined yield on that Treasury-backed dollar. Aumo is an AI agent whose core job is routing idle stablecoins into tokenized real-world-asset yield, on X Layer, preservation first.",
  },
  {
    q: "What do I deposit, and is there a minimum?",
    a: "USDT0 on X Layer, plus a little OKB for gas. No minimum and no lock-up. You receive pool shares and can redeem any time for your share of the pool plus any yield it earned.",
  },
  {
    q: "How do I know it is safe?",
    a: "Limits live in the contract, the AI can only ever tighten toward safety (never loosen a limit), every candidate allocation is stress-tested and passes an adversarial critic, and each venue is fork-proven against live mainnet contracts. The pool is covered by a full test and invariant suite.",
  },
  {
    q: "What does the agent actually do?",
    a: "Every cycle it scores each venue on risk, convenes a panel of specialist agents, checks a critic, and either rebalances or holds. You can replay any decision on the Activity page, tied to its on-chain transaction, or just ask the agent in plain language.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="border-t border-border/70">
      <div className="mx-auto w-full max-w-3xl px-5 py-24 sm:px-8">
        <span className="text-xs uppercase tracking-[0.14em] text-accent">FAQ</span>
        <h2 className="mt-3 text-balance text-2xl font-medium tracking-tight sm:text-3xl">
          The questions worth asking before you deposit.
        </h2>
        <div className="mt-10 flex flex-col divide-y divide-border border-y border-border">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {q}
                <span className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
