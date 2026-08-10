"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  getReceipts,
  getStatus,
  pct,
  timeAgo,
  txUrl,
  BAND_COLOR,
  type DecisionRecord,
  type Identity,
} from "@/lib/agent";
import { Panel, Label, Badge, Dot, RiskBar } from "@/components/ui";
import { AumoMark } from "@/components/mark";
import { Num } from "@/components/num";
import { AreaChart, Donut, type Segment } from "@/components/charts";
import { Loader } from "@/components/loader";
import { AskAumo } from "@/components/ask-aumo";
import { VenueIcon } from "@/components/venue-icon";
import { useAppBase } from "@/lib/use-app-base";

const unit = (raw: string | number, dec: number) => Number(raw) / 10 ** dec;
const VENUE_TONES = ["var(--accent)", "var(--muted-foreground)", "var(--foreground)", "var(--negative)"];

export default function Dashboard() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [status, receipts] = await Promise.all([getStatus(signal), getReceipts(24, signal)]);
      setIdentity(status.agent);
      setRecords(receipts);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "failed to reach the agent");
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

  if (error && !identity) return <ErrorState message={error} onRetry={() => load()} />;
  if (!identity || !records)
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <Loader label="Reaching the agent" />
      </div>
    );

  const latest = records[0];
  const vault = latest?.snapshot.vault;
  const dec = vault?.decimals ?? 6;
  const idle = vault ? unit(vault.idle, dec) : 0;
  const deployed = vault ? unit(vault.totalDeployed, dec) : 0;
  const total = idle + deployed;

  const series = [...records]
    .reverse()
    .map((r) => (r.plan.risks.length ? Math.max(...r.plan.risks.map((x) => x.riskAdjustedApyBps)) / 100 : null))
    .filter((v): v is number => v !== null);
  const bestNow = series.length ? series[series.length - 1] : 0;

  const venues = (latest?.snapshot.venues ?? [])
    .map((v) => {
      const risk = latest?.plan.risks.find((r) => r.address === v.address);
      return { ...v, bal: unit(v.liveBalance, dec), band: risk?.band, riskAdj: risk?.riskAdjustedApyBps };
    })
    .filter((v) => v.bal > 0)
    .sort((a, b) => b.bal - a.bal);

  const segments: Segment[] = [
    ...venues.map((v, i) => ({ label: v.name, value: v.bal, tone: VENUE_TONES[i % VENUE_TONES.length] })),
    ...(idle > 0 ? [{ label: "Idle", value: idle, tone: "var(--faint)" }] : []),
  ];
  const deployedPct = total > 0 ? Math.round((deployed / total) * 100) : 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
      <Header identity={identity} />

      {/* metrics */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Total assets" value={total} currency sub="Under management" />
        <Metric label="Idle" value={idle} currency sub="Ready to deploy" />
        <Metric label="Deployed" value={deployed} currency sub="Working in venues" />
        <Metric label="Best risk-adjusted" value={bestNow} suffix="%" frac={2} accent sub="Live yield" />
      </div>

      {/* charts + guardrails bento */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="flex flex-col p-5">
          <Label>Allocation</Label>
          <div className="mt-4 flex items-center gap-5">
            <Donut segments={segments} className="size-28 shrink-0" centerLabel={`${deployedPct}%`} centerSub="deployed" />
            <ul className="flex min-w-0 flex-1 flex-col gap-2">
              {segments.map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-sm">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: s.tone }} />
                  {s.label !== "Idle" ? <VenueIcon name={s.label} className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                  <span className="truncate text-muted-foreground">{s.label}</span>
                  <span className="tnum ml-auto text-foreground">
                    <Num value={s.value} currency maximumFractionDigits={0} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel className="flex flex-col p-5">
          <div className="flex items-center justify-between">
            <Label>Risk-adjusted yield</Label>
            <span className="tnum text-sm font-medium text-accent"><Num value={bestNow} suffix="%" maximumFractionDigits={2} /></span>
          </div>
          <div className="mt-4 flex-1">
            <AreaChart values={series} className="w-full" height={120} />
          </div>
          {series.length >= 2 ? (
            <span className="mt-2 text-[11px] text-faint">Last {series.length} cycles</span>
          ) : null}
        </Panel>

        {vault ? <GuardrailsCard vault={vault} identity={identity} dec={dec} /> : <div />}
      </div>

      <AskAumo />

      {latest ? <Decision rec={latest} dec={dec} /> : null}
      {latest && latest.plan.risks.length > 0 ? <RiskTable rec={latest} /> : null}
      <Receipts records={records} />
    </div>
  );
}

function Metric({ label, value, sub, suffix, currency, frac = 0, accent }: { label: string; value: number; sub?: string; suffix?: string; currency?: boolean; frac?: number; accent?: boolean }) {
  return (
    <Panel className="flex flex-col gap-1.5 p-5">
      <Label>{label}</Label>
      <span className={`tnum text-[1.75rem] font-medium leading-none ${accent ? "text-accent" : "text-foreground"}`}>
        <Num value={value} currency={currency} maximumFractionDigits={frac} suffix={suffix} />
      </span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </Panel>
  );
}

function Header({ identity }: { identity: Identity }) {
  return (
    <header className="flex flex-col gap-2 border-b border-border pb-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 className="text-xl font-medium tracking-tight">Overview</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-accent" /> Public view
        </span>
      </div>
      <span className="text-sm text-muted-foreground">
        The autonomous agent, live on {identity.chainName}. This is public, on-chain state, the same
        view everyone sees. Only your own deposit and balance need a connected wallet.
      </span>
    </header>
  );
}

function GuardrailsCard({ vault, identity, dec }: { vault: NonNullable<DecisionRecord["snapshot"]["vault"]>; identity: Identity; dec: number }) {
  const rows: [string, React.ReactNode][] = [
    ["Max per move", <Num key="1" value={unit(vault.maxMoveSize, dec)} currency maximumFractionDigits={0} />],
    ["Per-venue cap", <Num key="2" value={unit(vault.perVenueCap, dec)} currency maximumFractionDigits={0} />],
    ["Max deployed", <Num key="3" value={unit(vault.maxTotalDeployed, dec)} currency maximumFractionDigits={0} />],
    ["Risk appetite", <span key="4" className="capitalize">{identity.policy.appetite}</span>],
    ["Max concentration", `${Math.round(identity.policy.maxConcentration * 100)}%`],
  ];
  return (
    <Panel className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <Label>Guardrails</Label>
        {vault.paused ? <Badge tone="negative"><Dot tone="negative" /> Paused</Badge> : <Badge tone="positive"><Dot /> Active</Badge>}
      </div>
      <dl className="mt-4 flex flex-col gap-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tnum text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Decision({ rec, dec }: { rec: DecisionRecord; dec: number }) {
  const { plan, execution } = rec;
  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Label>Latest decision</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral"><span className="capitalize">{plan.regime}</span></Badge>
          <Badge tone="neutral">Appetite {plan.appetite}</Badge>
          <Badge tone="accent">{plan.source === "risk-engine+llm" ? "AI reasoning" : "Risk engine"}</Badge>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{plan.summary}</p>
      <div className="mt-5 flex flex-col gap-3">
        {plan.moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Holding. No move improves the risk-adjusted position under the current policy.</p>
        ) : (
          plan.moves.map((m, i) => {
            const ex = execution?.[i];
            return (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-card-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.action === "allocate" ? "positive" : "negative"}><span className="capitalize">{m.action}</span></Badge>
                    <span className="tnum text-sm text-foreground"><Num value={unit(m.amount, dec)} currency maximumFractionDigits={0} /></span>
                    <span className="text-sm text-muted-foreground">{m.action === "allocate" ? "into" : "from"} {m.venueName}</span>
                  </div>
                  <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{m.rationale}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`tnum text-xs ${BAND_COLOR[m.band]}`}>{pct(m.riskAdjustedApyBps)} risk-adj</span>
                  {ex?.hash ? (
                    <a className="text-xs text-accent hover:underline" href={txUrl(ex.hash)} target="_blank" rel="noreferrer">Receipt ↗</a>
                  ) : (
                    <span className="text-xs text-muted-foreground">Planned</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

function RiskTable({ rec }: { rec: DecisionRecord }) {
  return (
    <Panel className="p-5">
      <div className="mb-2"><Label>Risk engine</Label></div>
      <div className="flex flex-col divide-y divide-border">
        {rec.plan.risks.map((r) => (
          <div
            key={r.address}
            className="grid grid-cols-1 gap-x-6 gap-y-2 py-4 first:pt-3 last:pb-0 sm:grid-cols-[1.3fr_1.1fr_1.3fr_1fr] sm:items-center"
          >
            <span className="font-medium">{r.name}</span>
            <span className="tnum text-sm">
              <span className="text-muted-foreground">{pct(r.apyBps)}</span>
              <span className="mx-1.5 text-faint">→</span>
              <span className="text-accent">{pct(r.riskAdjustedApyBps)}</span>
            </span>
            <div className="flex items-center gap-2">
              <RiskBar score={r.riskScore} />
              <span className={`tnum shrink-0 text-xs ${BAND_COLOR[r.band]}`}>{Math.round(r.riskScore * 100)}</span>
              <span className={`shrink-0 text-[11px] capitalize ${BAND_COLOR[r.band]}`}>{r.band}</span>
            </div>
            <span className="text-xs text-muted-foreground">{r.notes.length ? r.notes.join("; ") : "-"}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Receipts({ records }: { records: DecisionRecord[] }) {
  const base = useAppBase();
  if (records.length === 0) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-muted-foreground">The agent hasn&apos;t recorded a decision yet. It runs on a schedule, so check back shortly.</p>
      </Panel>
    );
  }
  return (
    <Panel className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <Label>Recent decisions</Label>
        <Link href={`${base}/activity`} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
          View all →
        </Link>
      </div>
      <ol className="flex flex-col">
        {records.slice(0, 5).map((r, i) => (
          <li key={`${r.takenAt}-${i}`} className="flex items-start gap-4 border-b border-border py-3 last:border-0">
            <span className="tnum mt-0.5 w-16 shrink-0 text-xs text-muted-foreground">{timeAgo(r.takenAt)}</span>
            <div className="flex flex-col gap-1">
              <span className="line-clamp-2 text-sm text-foreground/90">{r.plan.summary}</span>
              <span className="text-[11px] text-muted-foreground">{r.plan.source === "risk-engine+llm" ? "AI reasoning" : "Risk engine"} · {r.plan.moves.length} move{r.plan.moves.length === 1 ? "" : "s"}</span>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <AumoMark className="size-6 text-foreground" />
      <p className="text-sm text-foreground">Couldn&apos;t reach the Aumo agent.</p>
      <p className="tnum text-xs text-muted-foreground">{message}</p>
      <button onClick={onRetry} className="rounded-lg border border-border px-4 py-2 text-sm hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button>
    </div>
  );
}
