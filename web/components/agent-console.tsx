"use client";

import { useEffect, useRef, useState } from "react";
import {
  getReceipts,
  txUrl,
  pct,
  short,
  timeAgo,
  type Band,
  type DecisionRecord,
} from "@/lib/agent";
import { AumoMark } from "./mark";
import { Num } from "./num";
import { Orb } from "./orb";

// The signature artifact: Aumo's agent shown doing the one thing it does. It
// scores venues by risk-adjusted yield, picks a move, and proves it on-chain.
// Live data only, no fabricated snapshot: it shows a loader until the hosted
// agent answers, and an honest offline state if it cannot be reached.

const BAND_INK: Record<Band, string> = {
  low: "text-accent",
  moderate: "text-muted-foreground",
  elevated: "text-negative",
  high: "text-negative",
};

export function AgentConsole() {
  const [rec, setRec] = useState<DecisionRecord | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [mounted, setMounted] = useState(false);
  const hasData = useRef(false); // ref, not the stale `rec` closure, so a live console isn't flipped Offline by one failed poll
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const r = await getReceipts(1, ctrl.signal);
        if (r[0]) {
          setRec(r[0]);
          setStatus("live");
          hasData.current = true;
        } else if (!hasData.current) setStatus("error");
      } catch (e) {
        // A transient poll failure after we've gone live keeps the last good data as "live";
        // only show Offline if we never reached the agent at all.
        if ((e as Error).name !== "AbortError" && !hasData.current) setStatus("error");
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="chamfer-edge w-full text-left">
      <div className="chamfer min-h-[280px] bg-surface">
        {/* title bar */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <AumoMark className="size-4 text-primary" />
            <span className="text-xs text-muted-foreground">
              Agent{rec ? ` · ${rec.agent.codename}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={`size-1.5 ${status === "live" ? "bg-accent" : "bg-faint"}`} style={{ borderRadius: 1 }} />
            <span className={status === "live" ? "text-accent" : "text-faint"}>
              {status === "live" ? "Live" : status === "error" ? "Offline" : "Connecting"}
              {mounted && rec ? ` · ${timeAgo(rec.takenAt)}` : ""}
            </span>
          </div>
        </div>

        {!rec ? (
          <div className="flex min-h-[220px] items-center justify-center">
            {status === "error" ? (
              <span className="text-sm text-muted-foreground">The agent is offline. Live data will appear when it reconnects.</span>
            ) : (
              <Orb className="size-6 text-accent" />
            )}
          </div>
        ) : (
          <Body rec={rec} />
        )}
      </div>
    </div>
  );
}

function Body({ rec }: { rec: DecisionRecord }) {
  const risks = rec.plan.risks;
  const dec = rec.snapshot.vault?.decimals ?? 6;
  const move = rec.plan.moves[0];
  const exec = rec.execution?.[0];
  const winner = move?.venueName;
  return (
    <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-[0.9fr_1.6fr]">
      {/* read: regime */}
      <div className="flex flex-col gap-3 bg-surface p-4 sm:p-5">
        <Field label="Regime" value={<span className="capitalize">{rec.plan.regime}</span>} />
        <Field label="Appetite" value={<span className="capitalize">{rec.plan.appetite}</span>} />
        <Field label="Reasoning" value={rec.plan.source === "risk-engine+llm" ? "Risk engine + AI" : "Risk engine"} />
        <Field label="Policy" value={<span className="font-mono text-faint">{short(rec.policyFingerprint)}</span>} />
      </div>

      {/* score → reason → prove */}
      <div className="flex flex-col bg-surface">
        <div className="px-4 pt-4 sm:px-5">
          <div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-x-4 text-[11px] text-faint">
            <span>Venue</span>
            <span className="text-right">APY → risk-adj</span>
            <span className="text-right">Band</span>
          </div>
          <div className="flex flex-col">
            {risks.map((r) => {
              const won = r.name === winner;
              return (
                <div key={r.address + r.name} className="tnum grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 border-t border-border/60 py-1.5 text-xs">
                  <span className={won ? "text-foreground" : "text-muted-foreground"}>
                    {r.name}
                    {won && <span className="ml-2 text-[10px] text-accent">← allocated</span>}
                  </span>
                  <span className="text-right text-muted-foreground">
                    <span className="text-faint">{pct(r.apyBps)}</span>
                    <span className="text-faint"> → </span>
                    <span className={won ? "text-accent" : "text-foreground"}>{pct(r.riskAdjustedApyBps)}</span>
                  </span>
                  <span className={`text-right capitalize ${BAND_INK[r.band]}`}>{r.band}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 border-t border-border px-4 py-3 sm:px-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="text-accent">Reason.</span> {rec.plan.summary}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-xs sm:px-5">
          <span className="text-foreground">
            <span className="capitalize">{move?.action ?? "hold"}</span>{" "}
            {move ? <Num value={Number(move.amount) / 10 ** dec} currency maximumFractionDigits={0} /> : null}
            {move ? ` → ${move.venueName}` : ""}
          </span>
          {exec?.hash ? (
            <a href={txUrl(exec.hash)} target="_blank" rel="noreferrer" className="font-mono text-faint underline decoration-border underline-offset-4 transition-colors hover:text-accent hover:decoration-accent">
              receipt {short(exec.hash)} · {exec.status}
            </a>
          ) : (
            <span className="text-faint">Receipt pending</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="text-xs text-foreground">{value}</span>
    </div>
  );
}
