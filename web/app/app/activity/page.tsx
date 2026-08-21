"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getReceipts, amount, pct, timeAgo, BAND_COLOR, type DecisionRecord } from "@/lib/agent";
import { Panel, Badge } from "@/components/ui";
import { Loader } from "@/components/loader";
import { DecisionReplay } from "@/components/decision-replay";
import { AttributionPanel } from "@/components/attribution-panel";

type Filter = "all" | "moved" | "held";

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-[11px] uppercase tracking-wide text-faint">{label}</span>
      <span className={`text-2xl font-medium tnum ${accent ? "text-accent" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

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

  const stats = useMemo(() => {
    const rs = records ?? [];
    const moved = rs.filter((r) => r.plan.moves.length > 0).length;
    return { total: rs.length, moved, held: rs.length - moved, regime: rs[0]?.plan.regime ?? "—" };
  }, [records]);

  const shown = (records ?? []).filter((r) =>
    filter === "all" ? true : filter === "moved" ? r.plan.moves.length > 0 : r.plan.moves.length === 0,
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium tracking-tight">Activity</h1>
        <span className="text-sm text-muted-foreground">
          Every decision the agent recorded — replay the full reasoning chain and follow each move on-chain.
        </span>
      </header>

      {/* summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Decisions" value={records ? stats.total : "—"} />
        <Stat label="Rebalanced" value={records ? stats.moved : "—"} accent />
        <Stat label="Held" value={records ? stats.held : "—"} />
        <Stat label="Latest regime" value={<span className="capitalize">{stats.regime}</span>} />
      </div>

      <AttributionPanel />

      {/* filter */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <span className="text-xs text-faint">{shown.length} shown</span>
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
      </div>

      {error && !records ? (
        <Panel className="p-8 text-center"><p className="text-sm text-negative">Couldn&apos;t reach the agent. {error}</p></Panel>
      ) : !records ? (
        <Loader label="Loading decisions" />
      ) : shown.length === 0 ? (
        <Panel className="p-8 text-center"><p className="text-sm text-muted-foreground">No decisions match this filter.</p></Panel>
      ) : (
        <ol className="flex flex-col">
          {shown.map((r, i) => {
            const id = r.takenAt; // stable across refetches so an open replay stays open
            const dec = r.snapshot.vault?.decimals ?? 6;
            const sym = r.snapshot.vault?.symbol ?? "USDT0";
            const isOpen = open === id;
            const moved = r.plan.moves.length > 0;
            const last = i === shown.length - 1;
            return (
              <li key={id} className="relative flex gap-4 pb-3">
                {/* timeline rail */}
                <div className="relative flex w-4 shrink-0 flex-col items-center pt-6">
                  <span className={`z-10 h-2.5 w-2.5 rounded-full ring-4 ring-background ${moved ? "bg-accent" : "bg-faint"}`} />
                  {!last ? <span className="absolute top-8 bottom-0 w-px bg-border" aria-hidden /> : null}
                </div>

                <Panel className={`flex-1 p-5 transition-colors ${isOpen ? "border-accent/40" : "hover:border-border/80"}`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="accent">{r.plan.source.startsWith("risk-engine+") ? "AI reasoning" : "Risk engine"}</Badge>
                      <Badge tone="neutral"><span className="capitalize">{r.plan.regime}</span></Badge>
                      {moved ? <Badge tone="positive">{r.plan.moves.length} move{r.plan.moves.length === 1 ? "" : "s"}</Badge> : <Badge tone="neutral">Held</Badge>}
                    </div>
                    <span className="tnum text-xs text-muted-foreground">{timeAgo(r.takenAt)}</span>
                  </div>

                  <p className="text-sm leading-relaxed text-foreground/90">{r.plan.summary}</p>

                  {moved ? (
                    <div className="mt-3 flex flex-col gap-1.5">
                      {r.plan.moves.map((m, j) => (
                        <div key={j} className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone={m.action === "allocate" ? "positive" : "negative"}><span className="capitalize">{m.action}</span></Badge>
                          <span className="tnum">{amount(m.amount, dec)} {sym}</span>
                          <span className="text-muted-foreground">{m.action === "allocate" ? "into" : "from"} {m.venueName}</span>
                          <span className={`tnum ${BAND_COLOR[m.band]}`}>{pct(m.riskAdjustedApyBps)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* replay toggle */}
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <button
                      onClick={() => setOpen(isOpen ? null : id)}
                      className="group flex items-center gap-1.5 text-xs font-medium text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={isOpen}
                    >
                      <span>{isOpen ? "Hide reasoning" : "Replay reasoning"}</span>
                      <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-[10px]">▾</motion.span>
                    </button>
                    <span className="font-mono text-[11px] text-faint" title="Policy fingerprint — the exact guardrails in force for this decision">
                      {r.policyFingerprint.slice(0, 14)}…
                    </span>
                  </div>

                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 rounded-lg border border-border bg-card-2/30 p-4">
                          <DecisionReplay rec={r} dec={dec} sym={sym} />
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </Panel>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
