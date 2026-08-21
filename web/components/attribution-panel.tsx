"use client";

import { useEffect, useState } from "react";
import { getAttribution, pct, timeAgo, type Attribution } from "@/lib/agent";
import { Panel, Badge } from "@/components/ui";

const usd = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Realized-yield proof. Shows the vault's price-per-share growth since tracking began — the honest
 * "beat idle" number (idle keeps it flat), net of every swap and move — plus where the yield
 * currently sits, attributed per venue. Data comes from the agent's /attribution endpoint, which
 * derives it from the on-chain receipts trail.
 */
export function AttributionPanel() {
  const [a, setA] = useState<Attribution | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      getAttribution(ctrl.signal)
        .then((r) => {
          setA(r);
          setFailed(false);
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setFailed(true);
        });
    load();
    const id = setInterval(load, 15000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, []);

  if (failed || !a) return null;

  const hasRealized = a.realizedYieldBps !== null;
  const up = (a.realizedYieldBps ?? 0) >= 0;

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Realized yield</span>
          <span className="text-sm text-muted-foreground">
            Price-per-share growth, net of every move. Not a projection.
          </span>
        </div>
        {hasRealized ? (
          <Badge tone={a.beatIdle ? "accent" : "neutral"}>
            {a.beatIdle ? "Beating idle" : "At idle"}
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Since tracking began</span>
          {hasRealized ? (
            <span className={`text-3xl font-medium tnum ${up ? "text-accent" : "text-foreground"}`}>
              {up ? "+" : ""}
              {pct(a.realizedYieldBps as number)}
            </span>
          ) : (
            <span className="text-3xl font-medium tnum text-muted-foreground">—</span>
          )}
          <span className="text-xs text-faint">
            vs 0.00% idle{a.trackedFromTs ? ` · from ${timeAgo(a.trackedFromTs)}` : " · building record"}
          </span>
        </div>

        {a.annualizedBps !== null ? (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-faint">Annualized</span>
            <span className="text-3xl font-medium tnum text-foreground">
              {pct(a.annualizedBps)}
            </span>
            <span className="text-xs text-faint">realized run-rate</span>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Yield earned</span>
          <span className="text-3xl font-medium tnum text-foreground">{usd(a.totalAccrued)}</span>
          <span className="text-xs text-faint">currently accrued across venues</span>
        </div>
      </div>

      {a.perVenue.length > 0 ? (
        <div className="mt-5 flex flex-col gap-2.5 border-t border-border pt-4">
          <span className="text-[11px] uppercase tracking-wide text-faint">Where it came from</span>
          {a.perVenue.map((v) => (
            <div key={v.address} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-foreground">{v.name}</span>
                <span className="tnum text-muted-foreground">
                  {usd(v.accrued)} · {(v.sharePct * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(2, v.sharePct * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
