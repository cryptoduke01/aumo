"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getReceipts,
  getStatus,
  amount,
  pct,
  short,
  timeAgo,
  txUrl,
  addrUrl,
  BAND_COLOR,
  type DecisionRecord,
  type Identity,
} from "@/lib/agent";
import { Panel, Label, Stat, Badge, Dot, RiskBar } from "@/components/ui";

const link =
  "underline decoration-border underline-offset-4 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm";

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
  if (!identity || !records) return <LoadingState />;

  const latest = records[0];
  const vault = latest?.snapshot.vault;
  const dec = vault?.decimals ?? 6;
  const sym = vault?.symbol ?? "USDT0";
  const total = vault ? Number(vault.idle) + Number(vault.totalDeployed) : 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Header identity={identity} latest={latest} />

      {/* Overview */}
      <Panel className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat
          label="Total assets"
          value={amount(String(total), dec)}
          sub={`${sym} under management`}
          accent
        />
        <Stat label="Idle" value={vault ? amount(vault.idle, dec) : "—"} sub="ready to deploy" />
        <Stat
          label="Deployed"
          value={vault ? amount(vault.totalDeployed, dec) : "—"}
          sub="working in venues"
        />
      </Panel>

      {/* Guardrails — control lives in the contract */}
      {vault ? (
        <Panel className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <Label>On-chain guardrails</Label>
            {vault.paused ? (
              <Badge tone="negative">
                <Dot tone="negative" /> paused
              </Badge>
            ) : (
              <Badge tone="positive">
                <Dot /> active
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-5">
            <Mini label="Max / move" value={`${amount(vault.maxMoveSize, dec)} ${sym}`} />
            <Mini label="Per-venue cap" value={`${amount(vault.perVenueCap, dec)} ${sym}`} />
            <Mini label="Max deployed" value={`${amount(vault.maxTotalDeployed, dec)} ${sym}`} />
            <Mini label="Risk appetite" value={identity.policy.appetite} />
            <Mini
              label="Max concentration"
              value={`${Math.round(identity.policy.maxConcentration * 100)}%`}
            />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            The agent can only move funds within these limits, into allowlisted venues. It cannot
            withdraw to any address or exceed a cap — remove it and the funds are still safe.
          </p>
        </Panel>
      ) : null}

      {latest ? <Decision rec={latest} dec={dec} sym={sym} /> : null}

      {latest && latest.plan.risks.length > 0 ? <RiskTable rec={latest} /> : null}

      <Receipts records={records} />

      <Footer identity={identity} latest={latest} />
    </div>
  );
}

function Header({ identity, latest }: { identity: Identity; latest?: DecisionRecord }) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <span className="text-xs text-muted-foreground">
          The autonomous agent, live on {identity.chainName}.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {latest ? (
          <Badge tone="positive">
            <Dot />
            <span className="motion-safe:animate-pulse">live</span> · {timeAgo(latest.takenAt)}
          </Badge>
        ) : null}
        <Badge tone={identity.hasReasoningLayer ? "gold" : "neutral"}>
          reasoning {identity.hasReasoningLayer ? "on" : "off"}
        </Badge>
        <Badge tone={identity.policy.execute ? "positive" : "neutral"}>
          {identity.policy.execute ? "executing" : "dry-run"}
        </Badge>
      </div>
    </header>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
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
          <Badge tone="gold">
            {plan.source === "risk-engine+llm" ? "AI reasoning" : "risk engine"}
          </Badge>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-foreground/90">{plan.summary}</p>

      <div className="mt-5 flex flex-col gap-3">
        {plan.moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Holding — no move improves the risk-adjusted position under the current policy.
          </p>
        ) : (
          plan.moves.map((m, i) => {
            const ex = execution?.[i];
            return (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card-2 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={m.action === "allocate" ? "positive" : "negative"}>
                      {m.action}
                    </Badge>
                    <span className="tnum font-mono text-sm">
                      {amount(m.amount, dec)} {sym}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {m.action === "allocate" ? "into" : "from"} {m.venueName}
                    </span>
                  </div>
                  <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    {m.rationale}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`tnum font-mono text-xs ${BAND_COLOR[m.band]}`}>
                    {pct(m.riskAdjustedApyBps)} risk-adj
                  </span>
                  {ex?.hash ? (
                    <a
                      className={`text-xs ${link}`}
                      href={txUrl(ex.hash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      receipt ↗
                    </a>
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
      <div className="mb-4">
        <Label>Risk engine</Label>
      </div>
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
                    <span className={`tnum shrink-0 font-mono text-xs ${BAND_COLOR[r.band]}`}>
                      {Math.round(r.riskScore * 100)}
                    </span>
                  </div>
                  <span className={`text-[11px] capitalize ${BAND_COLOR[r.band]}`}>{r.band}</span>
                </td>
                <td className="tnum py-3 pr-4 font-mono text-primary">{pct(r.riskAdjustedApyBps)}</td>
                <td className="py-3 text-xs text-muted-foreground">
                  {r.notes.length ? r.notes.join("; ") : "—"}
                </td>
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
        <p className="text-sm text-muted-foreground">
          The agent hasn&apos;t recorded a decision yet. It runs on a schedule — check back shortly.
        </p>
      </Panel>
    );
  }
  return (
    <Panel className="p-5">
      <div className="mb-4">
        <Label>Recent decisions</Label>
      </div>
      <ol className="flex flex-col">
        {records.map((r, i) => (
          <li
            key={`${r.takenAt}-${i}`}
            className="flex items-start gap-3 border-b border-border py-3 last:border-0"
          >
            <span className="tnum mt-0.5 w-16 shrink-0 font-mono text-xs text-muted-foreground">
              {timeAgo(r.takenAt)}
            </span>
            <div className="flex flex-col gap-1">
              <span className="line-clamp-2 text-sm text-foreground/90">{r.plan.summary}</span>
              <span className="text-[11px] text-muted-foreground">
                {r.plan.source === "risk-engine+llm" ? "AI reasoning" : "risk engine"} ·{" "}
                {r.plan.moves.length} move{r.plan.moves.length === 1 ? "" : "s"}
              </span>
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
        <span>
          Vault{" "}
          <a className={link} href={addrUrl(identity.vault)} target="_blank" rel="noreferrer">
            {short(identity.vault)} ↗
          </a>{" "}
          on {identity.chainName}
        </span>
        {latest ? (
          <span className="tnum font-mono">policy {latest.policyFingerprint.slice(0, 18)}…</span>
        ) : null}
      </div>
      <span>
        Every decision is bound to its policy fingerprint and anchored by on-chain receipts. Aumo v
        {identity.version} · {identity.build}
      </span>
    </footer>
  );
}

// --- states ---

function LoadingState() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="h-16 animate-pulse rounded-lg border border-border bg-card" />
      <div className="h-28 animate-pulse rounded-lg border border-border bg-card" />
      <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
      <div className="h-56 animate-pulse rounded-lg border border-border bg-card" />
      <span className="sr-only">Loading agent status</span>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <span className="text-primary" aria-hidden>
        ▲
      </span>
      <p className="text-sm text-foreground">Couldn&apos;t reach the Aumo agent.</p>
      <p className="tnum font-mono text-xs text-muted-foreground">{message}</p>
      <button
        onClick={onRetry}
        className="rounded-lg border border-border px-4 py-2 text-sm hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Retry
      </button>
    </div>
  );
}
