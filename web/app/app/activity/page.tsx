"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getReceiptsPage, getStatus, receiptsCsvUrl, amount, pct, timeAgo, BAND_COLOR, type DecisionRecord, type Status } from "@/lib/agent";
import { Panel, Badge, Label } from "@/components/ui";
import { Loader } from "@/components/loader";
import { DecisionReplay } from "@/components/decision-replay";
import { AttributionPanel } from "@/components/attribution-panel";
import { StockTrack } from "@/components/stock-track";

type Filter = "all" | "moved" | "held";
type View = "agent" | "stocks";

export default function ActivityPage() {
  const PAGE = 50;
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("agent");
  const [open, setOpen] = useState<string | null>(null);

  // Deep-link: /activity#stocks opens the Stocks tab (used by the dashboard's stock strip).
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#stocks") setView("stocks");
  }, []);
  const [paging, setPaging] = useState(false); // true once the user loads older pages → pause polling
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      // First page (newest PAGE); headline counts come from the status endpoint's true totals over
      // the whole trail, so a 300+ history isn't undersold by the display cap.
      const [recs, st] = await Promise.all([
        getReceiptsPage(PAGE, 0, signal),
        getStatus(signal).catch(() => null),
      ]);
      setRecords(recs);
      if (st) setStatus(st);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "failed");
    }
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const more = await getReceiptsPage(PAGE, records?.length ?? 0);
      setRecords((prev) => {
        const seen = new Set((prev ?? []).map((r) => r.takenAt));
        return [...(prev ?? []), ...more.filter((r) => !seen.has(r.takenAt))];
      });
      setPaging(true); // stop the live poll from resetting the paged view
    } catch {
      /* transient; the button stays available to retry */
    } finally {
      setLoadingMore(false);
    }
  }, [records]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    const id = setInterval(() => {
      if (!paging) load();
    }, 15000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load, paging]);

  const stats = useMemo(() => {
    const rs = records ?? [];
    // Prefer the server's true totals over the whole trail; fall back to the fetched page if the
    // status endpoint is unavailable (older agent build).
    const d = status?.decisions;
    const shownMoved = rs.filter((r) => r.plan.moves.length > 0).length;
    return {
      total: d?.total ?? rs.length,
      moved: d?.rebalanced ?? shownMoved,
      held: d?.held ?? rs.length - shownMoved,
      regime: status?.latest?.regime ?? rs[0]?.plan.regime ?? "—",
    };
  }, [records, status]);

  const shown = (records ?? []).filter((r) =>
    filter === "all" ? true : filter === "moved" ? r.plan.moves.length > 0 : r.plan.moves.length === 0,
  );

  return (
    <div className="mx-auto flex w-full max-w-[84rem] flex-1 flex-col gap-6 px-5 pb-20 sm:px-9">
      <header className="app-header">
        <h1 className="app-title">Activity</h1>
        <span className="app-lead">
          {view === "stocks"
            ? "The tokenized stocks Aumo holds. Live price, the day's move, exposure and market status."
            : "Every decision the agent recorded. Replay the full reasoning chain and follow each move on-chain."}
        </span>
      </header>

      {/* view toggle: the agent's stablecoin decisions, or the live stock book */}
      <div className="seg flex items-center self-start">
        {(["agent", "stocks"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="seg-item" data-active={view === v ? "" : undefined}
          >
            {v === "agent" ? "Agent decisions" : "Stocks"}
          </button>
        ))}
      </div>

      {view === "stocks" ? (
        <StockTrack />
      ) : (
      <>
      {/* the ledger at a glance: the count, a strip of recent decisions coloured by the regime the
          agent read (rebalances stand tall), and the supporting figures */}
      <section className="grid overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:border-r lg:border-border">
          <div className="flex flex-col gap-3">
            <Label>Decisions recorded</Label>
            <span className="tnum text-[clamp(3rem,5.6vw,4.75rem)] font-medium leading-[0.9] tracking-[-0.05em]">
              {records ? stats.total.toLocaleString("en-US") : "—"}
            </span>
            <span className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Every cycle leaves a receipt, whether the agent moves or holds.
            </span>
          </div>
          {records && records.length > 1 ? <RegimeStrip records={records.slice(0, 60)} /> : null}
        </div>
        <div className="grid grid-cols-2 border-t border-border lg:border-t-0">
          {[
            { label: "Rebalanced", value: records ? stats.moved.toLocaleString("en-US") : "—", sub: "Cycles that moved funds", accent: true },
            { label: "Held", value: records ? stats.held.toLocaleString("en-US") : "—", sub: "Cycles that chose not to" },
            { label: "Latest regime", value: <span className="capitalize">{stats.regime}</span>, sub: "The agent's current read" },
            { label: "Hold rate", value: records && stats.total ? `${Math.round((stats.held / stats.total) * 100)}%` : "—", sub: "Restraint is a decision too" },
          ].map((m, i) => (
            <div key={m.label} className={`flex flex-col gap-2 p-5 sm:p-6 ${i % 2 === 0 ? "border-r border-border" : ""} ${i < 2 ? "border-b border-border" : ""}`}>
              <Label>{m.label}</Label>
              <span className={`tnum text-[1.9rem] font-medium leading-none tracking-[-0.04em] ${m.accent ? "text-accent" : "text-foreground"}`}>{m.value}</span>
              <span className="text-xs text-muted-foreground">{m.sub}</span>
            </div>
          ))}
        </div>
      </section>

      <AttributionPanel />

      {/* filter */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium tracking-[-0.02em]">Ledger</h2>
          <span className="text-xs text-faint">
            {shown.length} shown{stats.total > (records?.length ?? 0) ? ` of ${stats.total}` : ""}
          </span>
          <a
            href={receiptsCsvUrl}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            title="Download every decision as CSV"
          >
            Export CSV
          </a>
        </div>
        <div className="seg flex items-center">
          {(["all", "moved", "held"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="seg-item capitalize" data-active={filter === f ? "" : undefined}
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
        <ol className="overflow-hidden rounded-2xl border border-border bg-card">
          {shown.map((r) => {
            const id = r.takenAt; // stable across refetches so an open replay stays open
            const dec = r.snapshot.vault?.decimals ?? 6;
            const sym = r.snapshot.vault?.symbol ?? "USDT0";
            const isOpen = open === id;
            const moved = r.plan.moves.length > 0;
            const when = new Date(r.takenAt);
            return (
              <li key={id} className={`border-b border-border transition-colors last:border-b-0 ${isOpen ? "bg-card-2/40" : "hover:bg-card-2/25"}`}>
                <div className="grid gap-4 p-5 sm:p-6 md:grid-cols-[10.5rem_minmax(0,1fr)] md:gap-8">
                  {/* when, and what the cycle did */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-col md:items-start md:gap-1.5">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className={`size-2 rounded-[2px] ${moved ? "bg-primary" : "bg-faint"}`} aria-hidden />
                      {moved ? "Rebalanced" : "Held"}
                    </span>
                    <span className="tnum text-xs text-muted-foreground">{timeAgo(r.takenAt)}</span>
                    <span className="tnum text-xs text-faint">
                      {when.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ·{" "}
                      {when.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge tone="accent">{r.plan.source.startsWith("risk-engine+") ? "AI reasoning" : "Risk engine"}</Badge>
                      <Badge tone="neutral"><span className="capitalize">{r.plan.regime}</span></Badge>
                      {moved ? <Badge tone="positive">{r.plan.moves.length} move{r.plan.moves.length === 1 ? "" : "s"}</Badge> : null}
                    </div>

                    <p className="max-w-[70ch] text-[1.02rem] leading-relaxed tracking-[-0.01em] text-foreground/90">{r.plan.summary}</p>

                    {moved ? (
                      <div className="mt-4 flex flex-col divide-y divide-border rounded-xl border border-border">
                        {r.plan.moves.map((m, j) => (
                          <div key={j} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                            <span className={`capitalize ${m.action === "allocate" ? "text-accent" : "text-negative"}`}>{m.action}</span>
                            <span className="tnum font-medium">{amount(m.amount, dec)} {sym}</span>
                            <span className="text-muted-foreground">{m.action === "allocate" ? "into" : "from"} {m.venueName}</span>
                            <span className={`tnum ml-auto ${BAND_COLOR[m.band]}`}>{pct(m.riskAdjustedApyBps)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <button
                        onClick={() => setOpen(isOpen ? null : id)}
                        className="flex items-center gap-1.5 text-sm font-medium text-accent transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={isOpen}
                      >
                        <span>{isOpen ? "Hide reasoning" : "Replay reasoning"}</span>
                        <motion.svg animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                          <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                        </motion.svg>
                      </button>
                      <span className="tnum truncate text-xs text-faint" title="Policy fingerprint: the exact guardrails in force for this decision">
                        Policy {r.policyFingerprint.slice(0, 12)}
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
                          <div className="mt-4 rounded-xl border border-border bg-background/60 p-4">
                            <DecisionReplay rec={r} dec={dec} sym={sym} />
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {records && stats.total > records.length ? (
        <div className="flex justify-center pt-1">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="chamfer bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] px-5 py-2.5 text-sm font-medium text-foreground transition-colors [--cut:9px] hover:bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : `Load ${Math.min(PAGE, stats.total - records.length)} more`}
          </button>
        </div>
      ) : null}
      </>
      )}
    </div>
  );
}

// Recent decisions as a strip of ticks, oldest on the left. Height and colour carry the agent's read:
// calm is quiet, cautious warms toward gold, anything defensive turns to the warning colour, and a
// cycle that actually moved funds stands full height in Sovereign.
function RegimeStrip({ records }: { records: DecisionRecord[] }) {
  const ticks = [...records].reverse();
  const tone = (r: DecisionRecord) => {
    if (r.plan.moves.length > 0) return { h: "100%", bg: "var(--primary)" };
    const g = (r.plan.regime || "").toLowerCase();
    if (g === "calm") return { h: "38%", bg: "color-mix(in srgb, var(--foreground) 22%, transparent)" };
    if (g === "cautious") return { h: "62%", bg: "color-mix(in srgb, var(--primary) 55%, transparent)" };
    return { h: "80%", bg: "var(--negative)" };
  };
  return (
    <div className="mt-auto flex flex-col gap-2.5">
      <div className="flex h-14 items-end gap-[3px]" role="img" aria-label={`Last ${ticks.length} decisions by regime`}>
        {ticks.map((r) => {
          const t = tone(r);
          return <span key={r.takenAt} className="min-w-0 flex-1 rounded-[2px]" style={{ height: t.h, background: t.bg }} title={`${r.plan.regime} · ${timeAgo(r.takenAt)}`} />;
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Last {ticks.length} decisions, newest on the right</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-[color-mix(in_srgb,var(--foreground)_22%,transparent)]" />Calm</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-[color-mix(in_srgb,var(--primary)_55%,transparent)]" />Cautious</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-negative" />Defensive</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-primary" />Rebalanced</span>
      </div>
    </div>
  );
}
