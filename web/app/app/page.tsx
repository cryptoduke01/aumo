"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getReceipts,
  getStatus,
  pct,
  short,
  timeAgo,
  txUrl,
  addrUrl,
  BAND_COLOR,
  type DecisionRecord,
  type Identity,
} from "@/lib/agent";
import { Panel, Label, Badge, Dot, RiskBar } from "@/components/ui";
import { AumoMark } from "@/components/mark";
import { Num } from "@/components/num";
import { Orb } from "@/components/orb";
import { Sparkline } from "@/components/sparkline";
import { Loader } from "@/components/loader";

const link =
  "underline decoration-border underline-offset-4 hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm";

const u = (raw: string | number, dec: number) => Number(raw) / 10 ** dec;

export default function Dashboard() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [records, setRecords] = useState<DecisionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [status, receipts] = await Promise.all([
        getStatus(signal),
        getReceipts(24, signal),
      ]);
      setIdentity(status.agent);
      setRecords(receipts);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setError(e instanceof Error ? e.message : "failed to reach the agent");
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
        <Loader label="reaching the agent" />
      </div>
    );

  const latest = records[0];
  const vault = latest?.snapshot.vault;
  const dec = vault?.decimals ?? 6;
  const sym = vault?.symbol ?? "USDT0";
  const idle = vault ? u(vault.idle, dec) : 0;
  const deployed = vault ? u(vault.totalDeployed, dec) : 0;
  const total = idle + deployed;

  // series: best risk-adjusted yield per recorded cycle, oldest to newest
  const series = [...records]
    .reverse()
    .map((r) => (r.plan.risks.length ? Math.max(...r.plan.risks.map((x) => x.riskAdjustedApyBps)) / 100 : null))
    .filter((v): v is number => v !== null);
  const bestNow = series.length ? series[series.length - 1] : 0;

  // allocation across venues, by live balance
  const venues = (latest?.snapshot.venues ?? [])
    .map((v) => {
      const risk = latest?.plan.risks.find((r) => r.address === v.address);
      return { ...v, bal: u(v.liveBalance, dec), band: risk?.band, riskAdj: risk?.riskAdjustedApyBps };
    })
    .filter((v) => v.bal > 0)
    .sort((a, b) => b.bal - a.bal);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Header identity={identity} latest={latest} />

      {/* metrics */}
      <Panel className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x [&>*]:border-border max-sm:[&>*:nth-child(-n+2)]:border-b max-sm:[&>*:nth-child(2)]:border-l">
        <Metric label="Total assets" value={total} sub={`${sym} managed`} />
        <Metric label="Idle" value={idle} sub="ready to deploy" />
        <Metric label="Deployed" value={deployed} sub="working in venues" />
        <Metric label="Best risk-adj" value={bestNow} suffix="%" frac={2} sub="live yield" accent />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* allocation */}
        <Panel className="flex flex-col p-5">
          <div className="mb-4 flex items-center justify-between">
            <Label>Allocation</Label>
            <span className="tnum font-mono text-xs text-faint">{venues.length} venue{venues.length === 1 ? "" : "s"}</span>
          </div>
          {venues.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Nothing deployed right now. The pool is holding idle.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {venues.map((v) => {
                const share = deployed > 0 ? (v.bal / deployed) * 100 : 0;
                return (
                  <div key={v.address} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="text-foreground">{v.name}</span>
                        {v.band ? <span className={`text-[11px] ${BAND_COLOR[v.band]}`}>{v.band}</span> : null}
                      </span>
                      <span className="tnum font-mono text-xs text-muted-foreground">
                        <Num value={v.bal} maximumFractionDigits={0} /> {sym}
                        <span className="ml-2 text-faint">{share.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* yield trend */}
        <Panel className="flex flex-col p-5">
          <div className="mb-4 flex items-center justify-between">
            <Label>Risk-adjusted yield</Label>
            <span className="tnum font-mono text-xs text-accent">
              <Num value={bestNow} suffix="%" maximumFractionDigits={2} />
            </span>
          </div>
          <Sparkline values={series} className="w-full" height={64} />
          <span className="mt-3 font-mono text-[11px] text-faint">
            {series.length < 2 ? "collecting cycle data" : `last ${series.length} cycles`}
          </span>
        </Panel>
      </div>

      {vault ? <Guardrails vault={vault} identity={identity} dec={dec} sym={sym} /> : null}

      {latest ? <Decision rec={latest} dec={dec} sym={sym} /> : null}
      {latest && latest.plan.risks.length > 0 ? <RiskTable rec={latest} /> : null}

      <Receipts records={records} />
      <Footer identity={identity} latest={latest} />
    </div>
  );
}

function Metric({ label, value, sub, suffix, frac = 0, accent }: { label: string; value: number; sub?: string; suffix?: string; frac?: number; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 p-5">
      <Label>{label}</Label>
      <span className={`font-mono text-2xl leading-none ${accent ? "text-accent" : "text-foreground"}`}>
        <Num value={value} maximumFractionDigits={frac} suffix={suffix} />
      </span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

function Header({ identity, latest }: { identity: Identity; latest?: DecisionRecord }) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-center gap-3">
        <Orb className="size-5 text-accent" />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium tracking-tight">Overview</h1>
          <span className="text-xs text-muted-foreground">The autonomous agent, live on {identity.chainName}.</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {latest ? (
          <Badge tone="positive"><Dot /> live · {timeAgo(latest.takenAt)}</Badge>
        ) : null}
        <Badge tone={identity.hasReasoningLayer ? "accent" : "neutral"}>reasoning {identity.hasReasoningLayer ? "on" : "off"}</Badge>
        <Badge tone={identity.policy.execute ? "positive" : "neutral"}>{identity.policy.execute ? "executing" : "dry-run"}</Badge>
      </div>
    </header>
  );
}

function Guardrails({ vault, identity, dec, sym }: { vault: NonNullable<DecisionRecord["snapshot"]["vault"]>; identity: Identity; dec: number; sym: string }) {
  return (
    <Panel className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <Label>On-chain guardrails</Label>
        {vault.paused ? <Badge tone="negative"><Dot tone="negative" /> paused</Badge> : <Badge tone="positive"><Dot /> active</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-5">
        <Mini label="Max / move" value={u(vault.maxMoveSize, dec)} sym={sym} />
        <Mini label="Per-venue cap" value={u(vault.perVenueCap, dec)} sym={sym} />
        <Mini label="Max deployed" value={u(vault.maxTotalDeployed, dec)} sym={sym} />
        <MiniText label="Risk appetite" value={identity.policy.appetite} />
        <MiniText label="Max concentration" value={`${Math.round(identity.policy.maxConcentration * 100)}%`} />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        The agent can only move funds within these limits, into allowlisted venues. It cannot withdraw to any address or exceed a cap. Remove it and the funds are still safe.
      </p>
    </Panel>
  );
}

function Mini({ label, value, sym }: { label: string; value: number; sym: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <span className="font-mono text-sm text-foreground"><Num value={value} maximumFractionDigits={0} /> {sym}</span>
    </div>
  );
}
function MiniText({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <span className="tnum font-mono text-sm capitalize text-foreground">{value}</span>
    </div>
  );
}

function Decision({ rec, dec, sym }: { rec: DecisionRecord; dec: number; sym: string }) {
  const { plan, execution } = rec;
  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Label>Latest decision</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{plan.regime}</Badge>
          <Badge tone="neutral">appetite {plan.appetite}</Badge>
          <Badge tone="accent">{plan.source === "risk-engine+llm" ? "AI reasoning" : "risk engine"}</Badge>
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
                  <div className="flex items-center gap-2">
                    <Badge tone={m.action === "allocate" ? "positive" : "negative"}>{m.action}</Badge>
                    <span className="tnum font-mono text-sm">{u(m.amount, dec).toLocaleString()} {sym}</span>
                    <span className="text-sm text-muted-foreground">{m.action === "allocate" ? "into" : "from"} {m.venueName}</span>
                  </div>
                  <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{m.rationale}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`tnum font-mono text-xs ${BAND_COLOR[m.band]}`}>{pct(m.riskAdjustedApyBps)} risk-adj</span>
                  {ex?.hash ? (
                    <a className={`text-xs ${link}`} href={txUrl(ex.hash)} target="_blank" rel="noreferrer">receipt ↗</a>
                  ) : (
                    <span className="text-xs text-muted-foreground">planned</span>
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
      <div className="mb-4"><Label>Risk engine</Label></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 font-medium">Venue</th>
              <th className="pb-2 font-medium">APY</th>
              <th className="w-40 pb-2 font-medium">Risk</th>
              <th className="pb-2 font-medium">Risk-adjusted</th>
              <th className="pb-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rec.plan.risks.map((r) => (
              <tr key={r.address}>
                <td className="py-3 pr-4 font-medium">{r.name}</td>
                <td className="tnum py-3 pr-4 font-mono">{pct(r.apyBps)}</td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <RiskBar score={r.riskScore} />
                    <span className={`tnum shrink-0 font-mono text-xs ${BAND_COLOR[r.band]}`}>{Math.round(r.riskScore * 100)}</span>
                  </div>
                  <span className={`text-[11px] capitalize ${BAND_COLOR[r.band]}`}>{r.band}</span>
                </td>
                <td className="tnum py-3 pr-4 font-mono text-accent">{pct(r.riskAdjustedApyBps)}</td>
                <td className="py-3 text-xs text-muted-foreground">{r.notes.length ? r.notes.join("; ") : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Receipts({ records }: { records: DecisionRecord[] }) {
  if (records.length === 0) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-muted-foreground">The agent hasn&apos;t recorded a decision yet. It runs on a schedule, so check back shortly.</p>
      </Panel>
    );
  }
  return (
    <Panel className="p-5">
      <div className="mb-4"><Label>Recent decisions</Label></div>
      <ol className="flex flex-col">
        {records.slice(0, 8).map((r, i) => (
          <li key={`${r.takenAt}-${i}`} className="flex items-start gap-3 border-b border-border py-3 last:border-0">
            <span className="tnum mt-0.5 w-16 shrink-0 font-mono text-xs text-muted-foreground">{timeAgo(r.takenAt)}</span>
            <div className="flex flex-col gap-1">
              <span className="line-clamp-2 text-sm text-foreground/90">{r.plan.summary}</span>
              <span className="text-[11px] text-muted-foreground">{r.plan.source === "risk-engine+llm" ? "AI reasoning" : "risk engine"} · {r.plan.moves.length} move{r.plan.moves.length === 1 ? "" : "s"}</span>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Footer({ identity, latest }: { identity: Identity; latest?: DecisionRecord }) {
  return (
    <footer className="mt-2 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <span>Vault <a className={link} href={addrUrl(identity.vault)} target="_blank" rel="noreferrer">{short(identity.vault)} ↗</a> on {identity.chainName}</span>
        {latest ? <span className="tnum font-mono">policy {latest.policyFingerprint.slice(0, 18)}…</span> : null}
      </div>
      <span>Every decision is bound to its policy fingerprint and anchored by on-chain receipts. Aumo v{identity.version} · {identity.build}</span>
    </footer>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <AumoMark className="size-6 text-foreground" />
      <p className="text-sm text-foreground">Couldn&apos;t reach the Aumo agent.</p>
      <p className="tnum font-mono text-xs text-muted-foreground">{message}</p>
      <button onClick={onRetry} className="rounded-lg border border-border px-4 py-2 text-sm hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">Retry</button>
    </div>
  );
}
