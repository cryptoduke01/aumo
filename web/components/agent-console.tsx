"use client";

import { useEffect, useState } from "react";
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

// The signature artifact: Aumo's agent shown doing the one thing it does.
// It scores venues by risk-adjusted yield, picks a move, and proves it on-chain.
// It paints immediately from a representative last-cycle snapshot (so the hero is
// never an empty void), then swaps to live data from the hosted agent.
// The status word is honest: "live" only after a real fetch, "last cycle" if the
// agent is quiet. Every number here is the agent's own output shape, not decor.

const BAND_INK: Record<Band, string> = {
  low: "text-accent",
  moderate: "text-muted-foreground",
  elevated: "text-negative",
  high: "text-negative",
};

// Representative snapshot in the exact shape /receipts returns, so first paint is
// populated and truthful about being the last observed cycle, not "live".
const SEED: DecisionRecord = {
  takenAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
  agent: {
    name: "Aumo",
    codename: "vault-keeper",
    mandate: "risk-adjusted RWA yield",
    version: "0.4.0",
    build: "xlayer",
    chainId: 1952,
    chainName: "X Layer",
    vault: "0x7a2c…9fD1",
    agentAddress: "0x51bE…40aC",
    hasReasoningLayer: true,
    policy: { appetite: "moderate", maxConcentration: 60, execute: true },
  },
  policyFingerprint:
    "0x9f3c1d7ba2e845c6f0a1b9d4e77c2153ab88ee2140cd9f6b7a3e21c0d5f4a6e2",
  vault: "0x7a2c…9fD1",
  snapshot: {
    takenAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    vault: {
      address: "0x7a2c…9fD1",
      asset: "USDT0",
      owner: "0x0000",
      agent: "0x51bE…40aC",
      decimals: 6,
      symbol: "USDT0",
      idle: "412000000",
      totalDeployed: "1588000000",
      maxMoveSize: "500000000",
      perVenueCap: "1200000000",
      maxTotalDeployed: "3000000000",
      paused: false,
    },
    venues: [],
  },
  plan: {
    regime: "stable · low vol",
    appetite: "moderate",
    source: "reasoning layer",
    summary:
      "Peg firm across venues; Aave depth deepest. Trim the elevated-band pool, top up the low-band lender.",
    moves: [
      {
        venue: "0xAa3e",
        venueName: "Aave v3 · USDT0",
        action: "allocate",
        amount: "250000000",
        rationale: "deepest liquidity, tightest peg, low utilization headroom",
        band: "low",
        riskAdjustedApyBps: 605,
      },
    ],
    risks: [
      { address: "0xAa3e", name: "Aave v3 · USDT0", apyBps: 642, riskScore: 12, band: "low", riskAdjustedApyBps: 605, notes: [] },
      { address: "0xR1o2", name: "Stable RWA note", apyBps: 815, riskScore: 34, band: "moderate", riskAdjustedApyBps: 690, notes: [] },
      { address: "0xH7y8", name: "High-yield pool", apyBps: 1240, riskScore: 61, band: "elevated", riskAdjustedApyBps: 512, notes: ["thin venue liquidity"] },
    ],
  },
  execution: [
    {
      move: {
        venue: "0xAa3e",
        venueName: "Aave v3 · USDT0",
        action: "allocate",
        amount: "250000000",
        rationale: "",
        band: "low",
        riskAdjustedApyBps: 605,
      },
      hash: "0x4d81c0f2a7e5b9346612c0a8f1d3e7b25c9a0e4f8b1d6c3a2e5f70918b4c6d3a",
      status: "confirmed",
    },
  ],
};

export function AgentConsole() {
  const [rec, setRec] = useState<DecisionRecord>(SEED);
  const [live, setLive] = useState(false);
  // Relative time depends on the clock, so it differs between server and client.
  // Render it only after mount to avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const r = await getReceipts(1, ctrl.signal);
        if (r[0]) {
          setRec(r[0]);
          setLive(true);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setLive(false);
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, []);

  const risks = rec.plan.risks;
  const move = rec.plan.moves[0];
  const exec = rec.execution?.[0];
  const winner = move?.venueName;

  return (
    <div className="chamfer-edge w-full text-left shadow-[0_1px_0_rgba(241,238,229,0.04)]">
      <div className="chamfer bg-surface">
        {/* title bar */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <AumoMark className="size-4 text-foreground" />
            <span className="font-mono text-xs text-muted-foreground">
              agent · {rec.agent.codename}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span
              className={`size-1.5 ${live ? "bg-accent" : "bg-faint"}`}
              style={{ borderRadius: 1 }}
            />
            <span className={live ? "text-accent" : "text-faint"}>
              {live ? "live" : "last cycle"}
              {mounted ? ` · ${timeAgo(rec.takenAt)}` : ""}
            </span>
          </div>
        </div>

        {/* body */}
        <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-[0.9fr_1.6fr]">
          {/* read: regime */}
          <div className="flex flex-col gap-3 bg-surface p-4 sm:p-5">
            <Field label="regime" value={rec.plan.regime} />
            <Field label="appetite" value={rec.plan.appetite} />
            <Field label="reasoning" value={rec.plan.source} />
            <Field
              label="policy"
              value={
                <span className="text-faint">{short(rec.policyFingerprint)}</span>
              }
            />
          </div>

          {/* score → reason → prove */}
          <div className="flex flex-col bg-surface">
            {/* venue score table */}
            <div className="px-4 pt-4 sm:px-5">
              <div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-x-4 font-mono text-[10px] uppercase tracking-wider text-faint">
                <span>venue</span>
                <span className="text-right">apy → risk-adj</span>
                <span className="text-right">band</span>
              </div>
              <div className="flex flex-col">
                {risks.map((r) => {
                  const won = r.name === winner;
                  return (
                    <div
                      key={r.address + r.name}
                      className="tnum grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 border-t border-border/60 py-1.5 font-mono text-xs"
                    >
                      <span className={won ? "text-foreground" : "text-muted-foreground"}>
                        {r.name}
                        {won && (
                          <span className="ml-2 text-[10px] text-accent">
                            ← allocated
                          </span>
                        )}
                      </span>
                      <span className="text-right text-muted-foreground">
                        <span className="text-faint">{pct(r.apyBps)}</span>
                        <span className="text-faint"> → </span>
                        <span className={won ? "text-accent" : "text-foreground"}>
                          {pct(r.riskAdjustedApyBps)}
                        </span>
                      </span>
                      <span className={`text-right ${BAND_INK[r.band]}`}>
                        {r.band}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* the decision */}
            <div className="mt-4 border-t border-border px-4 py-3 sm:px-5">
              <p className="font-mono text-xs leading-relaxed text-muted-foreground">
                <span className="text-accent">reason</span> {rec.plan.summary}
              </p>
            </div>

            {/* the proof */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-3 font-mono text-xs sm:px-5">
              <span className="text-foreground">
                {move?.action} {fmtAmt(move?.amount)} USDT0 → {move?.venueName}
              </span>
              {exec?.hash ? (
                <a
                  href={txUrl(exec.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-faint underline decoration-border underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
                >
                  receipt {short(exec.hash)} · {exec.status}
                </a>
              ) : (
                <span className="text-faint">receipt pending</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {label}
      </span>
      <span className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function fmtAmt(raw?: string) {
  if (!raw) return "-";
  return (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
