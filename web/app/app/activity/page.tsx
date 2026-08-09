"use client";

import { useCallback, useEffect, useState } from "react";
import { getReceipts, amount, pct, timeAgo, BAND_COLOR, type DecisionRecord } from "@/lib/agent";
import { Panel, Label, Badge, RiskBar } from "@/components/ui";
import { Loader } from "@/components/loader";

type Filter = "all" | "moved" | "held";

export default function ActivityPage() {
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setRecords(await getReceipts(50, signal));
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "failed");
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    const id = setInterval(() => load(), 15000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load]);

  const shown = (records ?? []).filter((r) =>
    filter === "all" ? true : filter === "moved" ? r.plan.moves.length > 0 : r.plan.moves.length === 0,
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium tracking-tight">Activity</h1>
          <span className="text-xs text-muted-foreground">
            Every decision the agent has recorded: its reasoning, the moves, and the governing policy.
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          {(["all", "moved", "held"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                filter === f ? "bg-card-2 text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "moved" ? "Rebalanced" : f}
            </button>
          ))}
        </div>
      </header>

      {error && !records ? (
        <Panel className="p-8 text-center"><p className="text-sm text-negative">Couldn&apos;t reach the agent. {error}</p></Panel>
      ) : !records ? (
        <Loader label="Loading decisions" />
      ) : shown.length === 0 ? (
        <Panel className="p-8 text-center"><p className="text-sm text-muted-foreground">No decisions match this filter.</p></Panel>
      ) : (
        <ol className="flex flex-col gap-3">
          {shown.map((r, i) => {
            const id = `${r.takenAt}-${i}`;
            const dec = r.snapshot.vault?.decimals ?? 6;
            const sym = r.snapshot.vault?.symbol ?? "USDT0";
            const isOpen = open === id;
            return (
              <Panel key={id} className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">{r.plan.source === "risk-engine+llm" ? "AI reasoning" : "Risk engine"}</Badge>
                    <Badge tone="neutral"><span className="capitalize">{r.plan.regime}</span></Badge>
                    {r.plan.moves.length === 0 ? <Badge tone="neutral">Held</Badge> : null}
                  </div>
                  <span className="tnum text-xs text-muted-foreground">{timeAgo(r.takenAt)}</span>
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">{r.plan.summary}</p>

                {r.plan.moves.length > 0 ? (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {r.plan.moves.map((m, j) => (
                      <div key={j} className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone={m.action === "allocate" ? "positive" : "negative"}><span className="capitalize">{m.action}</span></Badge>
                        <span className="tnum ">{amount(m.amount, dec)} {sym}</span>
                        <span className="text-muted-foreground">{m.action === "allocate" ? "into" : "from"} {m.venueName}</span>
                        <span className={`tnum ${BAND_COLOR[m.band]}`}>{pct(m.riskAdjustedApyBps)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">Held. No move.</p>
                )}

                {/* expandable risk breakdown */}
                {r.plan.risks.length > 0 ? (
                  <div className="mt-3">
                    <button
                      onClick={() => setOpen(isOpen ? null : id)}
                      className="text-[11px] text-faint transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? "Hide" : "Show"} risk breakdown ({r.plan.risks.length})
                    </button>
                    {isOpen ? (
                      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                        {r.plan.risks.map((rk) => (
                          <div key={rk.address} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 text-xs">
                            <span className="text-muted-foreground">{rk.name}</span>
                            <div className="flex w-40 items-center gap-2">
                              <RiskBar score={rk.riskScore} />
                              <span className={`tnum shrink-0 ${BAND_COLOR[rk.band]}`}>{Math.round(rk.riskScore * 100)}</span>
                            </div>
                            <span className="tnum text-right text-accent">{pct(rk.riskAdjustedApyBps)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-3 border-t border-border pt-2">
                  <span className="text-[11px] text-muted-foreground">Policy </span>
                  <span className="font-mono text-[11px] text-faint">{r.policyFingerprint.slice(0, 18)}…</span>
                </div>
              </Panel>
            );
          })}
        </ol>
      )}
    </div>
  );
}
