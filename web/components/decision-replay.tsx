import { amount, pct, txUrl, BAND_COLOR, type DecisionRecord } from "@/lib/agent";
import { Badge, RiskBar } from "./ui";

/**
 * Decision replay — the full reasoning chain behind one recorded decision, in the order the agent
 * ran it: risk engine → stress → reflection → specialist panel → critic → the on-chain move. Every
 * stage can only ADD caution (tighten-only), so reading top to bottom shows exactly how the raw
 * candidate plan was narrowed to what actually executed. All of it comes straight from the receipt,
 * so it is auditable, not narrated.
 */

function Stage({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-7">
      {/* rail + node */}
      <span className="absolute left-[9px] top-5 bottom-[-14px] w-px bg-border last:hidden" aria-hidden />
      <span className="absolute left-0 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-card-2 text-[10px] tnum text-muted-foreground">
        {n}
      </span>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{title}</span>
        {children}
      </div>
    </div>
  );
}

export function DecisionReplay({ rec, dec, sym }: { rec: DecisionRecord; dec: number; sym: string }) {
  const { plan, execution } = rec;
  const stages: React.ReactNode[] = [];
  let n = 1;

  // 1 — Risk engine: the raw scored candidates.
  if (plan.risks.length > 0) {
    stages.push(
      <Stage key="engine" n={n++} title="Risk engine · scored the venues">
        <div className="flex flex-col gap-1.5">
          {plan.risks.map((rk) => (
            <div key={rk.address} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 text-xs">
              <span className="text-muted-foreground">{rk.name}</span>
              <div className="flex w-36 items-center gap-2">
                <RiskBar score={rk.riskScore} />
                <span className={`tnum shrink-0 ${BAND_COLOR[rk.band]}`}>{Math.round(rk.riskScore * 100)}</span>
              </div>
              <span className="tnum text-right text-accent">{pct(rk.riskAdjustedApyBps)}</span>
            </div>
          ))}
        </div>
      </Stage>,
    );
  }

  // 2 — Stress test.
  if (plan.stress) {
    const s = plan.stress;
    stages.push(
      <Stage key="stress" n={n++} title="Stress test · simulated a shock">
        <p className="text-xs text-muted-foreground">
          Fragility <span className={`tnum ${s.fragility > 0 ? "text-negative" : "text-foreground"}`}>{Math.round(s.fragility * 100)}%</span>
          {" · "}regime ceiling <span className="capitalize text-foreground">{s.recommendedRegime}</span>
          {s.fragileNames.length > 0 ? <> · fragile: <span className="text-negative">{s.fragileNames.join(", ")}</span></> : <> · none fragile</>}
        </p>
      </Stage>,
    );
  }

  // 3 — Reflection.
  if (plan.reflection) {
    const rf = plan.reflection;
    stages.push(
      <Stage key="reflect" n={n++} title="Reflection · graded its own past calls">
        <p className="text-xs text-muted-foreground">
          {rf.flagged} prior trend {rf.flagged === 1 ? "call" : "calls"} graded · hit rate{" "}
          <span className="tnum text-foreground">{Math.round(rf.hitRate * 100)}%</span> · momentum weight{" "}
          <span className="tnum text-foreground">×{rf.calibration.toFixed(2)}</span>
        </p>
      </Stage>,
    );
  }

  // 4 — Specialist panel.
  if (plan.panel && plan.panel.verdicts.length > 0) {
    stages.push(
      <Stage key="panel" n={n++} title={`Panel · ${plan.panel.verdicts.length} specialists weighed in`}>
        <div className="flex flex-col gap-2">
          {plan.panel.verdicts.map((v) => (
            <div key={v.role} className="flex flex-col gap-1 rounded-md border border-border/60 bg-card-2/40 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral"><span className="capitalize">{v.role}</span></Badge>
                <span className="tnum text-[11px] text-muted-foreground">concern {Math.round(v.concern * 100)}%</span>
                {v.vetoes.length > 0 ? <Badge tone="negative">{v.vetoes.length} veto{v.vetoes.length === 1 ? "" : "es"}</Badge> : null}
                {v.regime ? <Badge tone="neutral">regime <span className="capitalize">&nbsp;{v.regime}</span></Badge> : null}
              </div>
              {v.note ? <p className="text-[11px] leading-relaxed text-muted-foreground">{v.note}</p> : null}
            </div>
          ))}
        </div>
      </Stage>,
    );
  }

  // 5 — Critic.
  if (plan.critic) {
    const c = plan.critic;
    stages.push(
      <Stage key="critic" n={n++} title="Critic · adversarial final gate">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {c.doubt ? <Badge tone="negative">Held the cycle</Badge> : c.vetoes.length > 0 ? <Badge tone="negative">{c.vetoes.length} veto{c.vetoes.length === 1 ? "" : "es"}</Badge> : <Badge tone="positive">Cleared</Badge>}
          </div>
          {c.concerns.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {c.concerns.map((con, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-muted-foreground">{con}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </Stage>,
    );
  }

  // 6 — Outcome: what actually executed, anchored on-chain.
  stages.push(
    <Stage key="outcome" n={n++} title="Outcome · committed on-chain">
      {plan.moves.length === 0 ? (
        <p className="text-xs text-muted-foreground">Held. No move this cycle — the safeguards above kept capital idle.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {plan.moves.map((m, j) => {
            const ex = execution?.find((e) => e.move.venue === m.venue && e.move.action === m.action);
            return (
              <div key={j} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={m.action === "allocate" ? "positive" : "negative"}><span className="capitalize">{m.action}</span></Badge>
                <span className="tnum">{amount(m.amount, dec)} {sym}</span>
                <span className="text-muted-foreground">{m.action === "allocate" ? "into" : "from"} {m.venueName}</span>
                {ex?.hash ? (
                  <a href={txUrl(ex.hash)} target="_blank" rel="noreferrer" className="tnum text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
                    {ex.status} ↗
                  </a>
                ) : ex ? (
                  <span className="text-faint">{ex.status}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Stage>,
  );

  return <div className="flex flex-col gap-4">{stages}</div>;
}
