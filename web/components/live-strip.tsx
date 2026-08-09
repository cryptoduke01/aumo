"use client";

import { useEffect, useState } from "react";
import { getReceipts, amount, pct, timeAgo, type DecisionRecord } from "@/lib/agent";

// The Ornn "index price" equivalent, but real: live numbers pulled from Aumo's own agent.
export function LiveStrip() {
  const [rec, setRec] = useState<DecisionRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const r = await getReceipts(1, ctrl.signal);
        if (r[0]) setRec(r[0]);
        setFailed(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, []);

  if (failed && !rec) return null; // fail quiet, never break the hero

  const dec = rec?.snapshot.vault?.decimals ?? 6;
  const sym = rec?.snapshot.vault?.symbol ?? "USDT0";
  const managed = rec
    ? Number(rec.snapshot.vault.idle) + Number(rec.snapshot.vault.totalDeployed)
    : undefined;
  const bestYield = rec?.plan.risks.length
    ? Math.max(...rec.plan.risks.map((r) => r.riskAdjustedApyBps))
    : undefined;

  const dash = "—";
  return (
    <div className="tnum mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-3 font-mono text-xs text-muted-foreground">
      <Stat
        label="best risk-adj yield"
        value={bestYield !== undefined ? pct(bestYield) : dash}
        accent
      />
      <Sep />
      <Stat label="assets managed" value={managed !== undefined ? `${amount(String(managed), dec)} ${sym}` : dash} />
      <Sep />
      <span className="inline-flex items-center gap-2">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-1.5 rounded-full bg-positive" />
        </span>
        <span>agent live{rec ? ` · updated ${timeAgo(rec.takenAt)}` : ""}</span>
      </span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="uppercase tracking-wider">{label}</span>
      <span className={accent ? "text-primary" : "text-foreground"}>{value}</span>
    </span>
  );
}

function Sep() {
  return <span className="hidden text-border sm:inline">·</span>;
}
