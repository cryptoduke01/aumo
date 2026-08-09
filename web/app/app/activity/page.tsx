"use client";

import { useCallback, useEffect, useState } from "react";
import { getReceipts, amount, pct, timeAgo, BAND_COLOR, type DecisionRecord } from "@/lib/agent";
import { Panel, Label, Badge } from "@/components/ui";

export default function ActivityPage() {
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1 border-b border-border pb-6">
        <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
        <span className="text-xs text-muted-foreground">
          Every decision the agent has recorded — its reasoning, the moves, and the governing policy.
        </span>
      </header>

      {error && !records ? (
        <Panel className="p-8 text-center">
          <p className="text-sm text-negative">Couldn&apos;t reach the agent. {error}</p>
        </Panel>
      ) : !records ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <Panel className="p-8 text-center">
          <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
        </Panel>
      ) : (
        <ol className="flex flex-col gap-3">
          {records.map((r, i) => {
            const dec = r.snapshot.vault?.decimals ?? 6;
            const sym = r.snapshot.vault?.symbol ?? "USDT0";
            return (
              <Panel key={`${r.takenAt}-${i}`} className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">
                      {r.plan.source === "risk-engine+llm" ? "AI reasoning" : "risk engine"}
                    </Badge>
                    <Badge tone="neutral">{r.plan.regime}</Badge>
                  </div>
                  <span className="tnum font-mono text-xs text-muted-foreground">{timeAgo(r.takenAt)}</span>
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">{r.plan.summary}</p>
                {r.plan.moves.length > 0 ? (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {r.plan.moves.map((m, j) => (
                      <div key={j} className="flex items-center gap-2 text-xs">
                        <Badge tone={m.action === "allocate" ? "positive" : "negative"}>{m.action}</Badge>
                        <span className="tnum font-mono">{amount(m.amount, dec)} {sym}</span>
                        <span className="text-muted-foreground">
                          {m.action === "allocate" ? "into" : "from"} {m.venueName}
                        </span>
                        <span className={`tnum font-mono ${BAND_COLOR[m.band]}`}>{pct(m.riskAdjustedApyBps)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">Held — no move.</p>
                )}
                <div className="mt-3 border-t border-border pt-2">
                  <span className="tnum font-mono text-[11px] text-muted-foreground">
                    policy {r.policyFingerprint.slice(0, 18)}…
                  </span>
                </div>
              </Panel>
            );
          })}
        </ol>
      )}
    </div>
  );
}
