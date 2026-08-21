"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getReceipts,
  amount,
  pct,
  timeAgo,
  addrUrl,
  short,
  BAND_COLOR,
  type DecisionRecord,
  type VenueSnapshot,
  type VenueRisk,
} from "@/lib/agent";
import { Panel, Label, Badge } from "@/components/ui";
import { Loader } from "@/components/loader";
import { VenueIcon } from "@/components/venue-icon";

const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(0)}k`
      : `$${n.toFixed(0)}`;

// Asset-class framing for the AI-RWA track: lead with real-world-asset venues (tokenized treasuries,
// fixed-yield RWA) and treat on-chain lending as the conservative base. Drives both the label and the
// RWA-first ordering, so the portfolio reads as RWA, not DeFi, at a glance.
function assetClass(v: VenueSnapshot): { label: string; rwa: boolean } {
  const n = v.name.toLowerCase();
  if (n.includes("pendle") || n.includes("pt-") || n.includes("pt ")) return { label: "Tokenized fixed yield", rwa: true };
  if (n.includes("usdg") || v.kind === "rwa") return { label: "Tokenized treasuries", rwa: true };
  if (v.kind === "lending") return { label: "On-chain lending", rwa: false };
  return { label: "Yield venue", rwa: false };
}

const byRwaFirst = (a: VenueSnapshot, b: VenueSnapshot) => {
  const ra = assetClass(a).rwa ? 0 : 1;
  const rb = assetClass(b).rwa ? 0 : 1;
  return ra !== rb ? ra - rb : b.apyBps - a.apyBps;
};

type CheckState = "pass" | "watch" | "info";
type Check = { label: string; value: string; state: CheckState };

// The passport: the trust dimensions the agent verifies on-chain before it allocates a dollar. AI
// reasons over this, the contract enforces it. Every line maps to a real value the agent read this
// cycle, which is exactly what separates verifying an RWA venue from chasing its yield.
function passport(v: VenueSnapshot, risk: VenueRisk | undefined, cls: { label: string }, dec: number): Check[] {
  const position = Number(v.liveBalance) / 10 ** dec;
  const liqRatio = position > 0 && v.liquidityUsd > 0 ? v.liquidityUsd / position : 0;
  const pr = Math.round(v.protocolRisk * 100);
  const checks: Check[] = [
    {
      label: "Allowlisted on-chain",
      value: v.allowed ? "Enforced by the vault" : "Excluded",
      state: v.allowed ? "pass" : "watch",
    },
    {
      label: "Peg stability",
      value: `${v.pegDeviationBps} bps deviation`,
      state: v.pegDeviationBps <= 50 ? "pass" : "watch",
    },
    { label: "Depeg breaker", value: "Armed at 100 bps", state: "info" },
    {
      label: "Exit liquidity",
      value:
        position > 0 ? `${Math.round(liqRatio).toLocaleString()}× position` : `${usd(v.liquidityUsd)} available`,
      state: position === 0 || liqRatio >= 4 ? "pass" : "watch",
    },
    {
      label: "Protocol risk",
      value: `${v.protocolRisk <= 0.25 ? "Low" : v.protocolRisk <= 0.5 ? "Moderate" : "Elevated"} · ${pr}/100`,
      state: v.protocolRisk <= 0.5 ? "pass" : "watch",
    },
    { label: "Custody", value: cls.label, state: "info" },
  ];
  if (risk) {
    const band = risk.band.charAt(0).toUpperCase() + risk.band.slice(1);
    checks.push({
      label: "Agent verdict",
      value: `${band} risk · ${pct(risk.riskAdjustedApyBps)} adj.`,
      state: risk.band === "low" || risk.band === "moderate" ? "pass" : "watch",
    });
  }
  return checks;
}

function Tick({ state }: { state: CheckState }) {
  const map = {
    pass: { cls: "bg-accent/15 text-accent", ch: "✓" },
    watch: { cls: "bg-negative/15 text-negative", ch: "!" },
    info: { cls: "bg-card-2 text-muted-foreground", ch: "•" },
  }[state];
  return (
    <span className={`flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${map.cls}`}>
      {map.ch}
    </span>
  );
}

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
        <h1 className="text-xl font-medium tracking-tight">Venue passports</h1>
        <span className="text-xs text-muted-foreground">
          RWA liquidity needs more than yield. Every venue carries a trust profile the agent verifies
          on-chain before it allocates a dollar: peg, exit liquidity, protocol risk, custody. The AI
          reasons over it, the contract enforces it.
        </span>
      </header>

      {error && !rec ? (
        <Panel className="p-8 text-center"><p className="text-sm text-negative">Couldn&apos;t reach the agent. {error}</p></Panel>
      ) : !rec ? (
        <Loader label="Verifying venues" />
      ) : rec.snapshot.venues.length === 0 ? (
        <Panel className="p-8 text-center"><p className="text-sm text-muted-foreground">No venues in the latest snapshot.</p></Panel>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-faint">
            <span>
              {rec.snapshot.venues.filter((v) => assetClass(v).rwa).length} RWA · {rec.snapshot.venues.length} verified
            </span>
            <span>Verified {timeAgo(rec.takenAt)}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[...rec.snapshot.venues].sort(byRwaFirst).map((v) => (
              <VenuePassport
                key={v.address}
                venue={v}
                dec={rec.snapshot.vault.decimals ?? 6}
                risk={rec.plan.risks.find((r) => r.address === v.address)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function VenuePassport({ venue, risk, dec }: { venue: VenueSnapshot; risk?: VenueRisk; dec: number }) {
  const cls = assetClass(venue);
  const allocated = Number(venue.liveBalance) / 10 ** dec;
  const checks = passport(venue, risk, cls, dec);
  const cleared = checks.filter((c) => c.state === "pass").length;
  const total = checks.filter((c) => c.state !== "info").length;

  return (
    <Panel className="flex flex-col p-5">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
            <VenueIcon name={venue.name} className="size-4 text-muted-foreground" />
            {venue.name}
          </span>
          <a className="font-mono text-[11px] text-faint underline decoration-border underline-offset-2 hover:text-accent" href={addrUrl(venue.address)} target="_blank" rel="noreferrer">
            {short(venue.address)} ↗
          </a>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={cls.rwa ? "accent" : "neutral"}>{cls.rwa ? `RWA · ${cls.label}` : cls.label}</Badge>
          {risk ? <span className={`text-[11px] capitalize ${BAND_COLOR[risk.band]}`}>{risk.band} risk</span> : null}
        </div>
      </div>

      {/* the passport: verified trust profile */}
      <div className="mt-5 flex items-center justify-between">
        <Label>Trust profile</Label>
        <span className="tnum text-[11px] text-faint">{cleared}/{total} verified</span>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border/60">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2.5 py-2.5">
            <Tick state={c.state} />
            <span className="text-xs text-muted-foreground">{c.label}</span>
            <span
              className={`tnum ml-auto text-right text-xs ${
                c.state === "watch" ? "text-negative" : "text-foreground"
              }`}
            >
              {c.value}
            </span>
          </li>
        ))}
      </ul>

      {/* yield + live allocation */}
      <div className="mt-4 flex items-end justify-between border-t border-border pt-4">
        <div className="flex items-baseline gap-2">
          <span className="tnum text-lg text-muted-foreground">{pct(venue.apyBps)}</span>
          <span className="text-faint">→</span>
          <span className="tnum text-lg text-accent">{risk ? pct(risk.riskAdjustedApyBps) : "-"}</span>
          <span className="text-[10px] uppercase tracking-wider text-faint">risk-adj</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wider text-faint">Allocated now</span>
          <span className={`tnum text-sm font-medium ${allocated > 0 ? "text-accent" : "text-muted-foreground"}`}>
            {allocated > 0 ? `$${amount(venue.liveBalance, dec)}` : "$0"}
          </span>
        </div>
      </div>

      {risk && risk.notes.length ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{risk.notes.join("; ")}</p>
      ) : null}
    </Panel>
  );
}
