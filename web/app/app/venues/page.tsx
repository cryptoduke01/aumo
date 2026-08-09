"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getReceipts,
  pct,
  timeAgo,
  addrUrl,
  short,
  BAND_COLOR,
  type DecisionRecord,
  type VenueSnapshot,
  type VenueRisk,
} from "@/lib/agent";
import { Panel, Label, Badge, RiskBar } from "@/components/ui";
import { Loader } from "@/components/loader";
import { VenueIcon } from "@/components/venue-icon";

const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(0)}k`
      : `$${n.toFixed(0)}`;

export default function VenuesPage() {
  const [rec, setRec] = useState<DecisionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await getReceipts(1, signal);
      setRec(r[0] ?? null);
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
        <h1 className="text-xl font-medium tracking-tight">Venues</h1>
        <span className="text-xs text-muted-foreground">
          Every allowlisted venue and how the risk engine scores it. The agent can allocate to these and nowhere else.
        </span>
      </header>

      {error && !rec ? (
        <Panel className="p-8 text-center"><p className="text-sm text-negative">Couldn&apos;t reach the agent. {error}</p></Panel>
      ) : !rec ? (
        <Loader label="Scoring venues" />
      ) : rec.snapshot.venues.length === 0 ? (
        <Panel className="p-8 text-center"><p className="text-sm text-muted-foreground">No venues in the latest snapshot.</p></Panel>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-faint">
            <span>{rec.snapshot.venues.length} allowlisted</span>
            <span>Scored {timeAgo(rec.takenAt)}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rec.snapshot.venues.map((v) => (
              <VenueCard key={v.address} venue={v} risk={rec.plan.risks.find((r) => r.address === v.address)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VenueCard({ venue, risk }: { venue: VenueSnapshot; risk?: VenueRisk }) {
  const factors: [string, string][] = [
    ["Protocol risk", `${Math.round(venue.protocolRisk * 100)}/100`],
    ["Utilization", `${Math.round(venue.utilization * 100)}%`],
    ["Peg deviation", `${venue.pegDeviationBps} bps`],
    ["TVL", usd(venue.tvlUsd)],
    ["Liquidity", usd(venue.liquidityUsd)],
    ["Kind", venue.kind],
  ];
  return (
    <Panel className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 font-medium text-foreground">
            <VenueIcon name={venue.name} className="size-4 text-muted-foreground" />
            {venue.name}
          </span>
          <a className="font-mono text-[11px] text-faint underline decoration-border underline-offset-2 hover:text-accent" href={addrUrl(venue.address)} target="_blank" rel="noreferrer">
            {short(venue.address)} ↗
          </a>
        </div>
        {venue.allowed ? <Badge tone="accent">Allowlisted</Badge> : <Badge tone="neutral">Excluded</Badge>}
      </div>

      {/* yields */}
      <div className="mt-4 flex items-end justify-between border-y border-border py-4">
        <div className="flex flex-col gap-1">
          <Label>APY</Label>
          <span className="tnum text-lg text-muted-foreground">{pct(venue.apyBps)}</span>
        </div>
        <span className="pb-1 text-faint">→</span>
        <div className="flex flex-col items-end gap-1">
          <Label>Risk-adjusted</Label>
          <span className="tnum text-lg text-accent">{risk ? pct(risk.riskAdjustedApyBps) : "-"}</span>
        </div>
      </div>

      {/* risk band */}
      {risk ? (
        <div className="mt-4 flex items-center gap-3">
          <RiskBar score={risk.riskScore} />
          <span className={`tnum shrink-0 text-xs ${BAND_COLOR[risk.band]}`}>{Math.round(risk.riskScore * 100)}</span>
          <span className={`shrink-0 text-[11px] capitalize ${BAND_COLOR[risk.band]}`}>{risk.band}</span>
        </div>
      ) : null}

      {/* factors */}
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {factors.map(([k, val]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-[10px] uppercase tracking-wider text-faint">{k}</dt>
            <dd className="tnum text-xs capitalize text-foreground">{val}</dd>
          </div>
        ))}
      </dl>

      {risk && risk.notes.length ? (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">{risk.notes.join("; ")}</p>
      ) : null}
    </Panel>
  );
}
