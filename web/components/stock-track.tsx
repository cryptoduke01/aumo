"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContracts } from "wagmi";
import { liveStocks, equityOracleAbi, equityPoolAbi, activeChain, type StockConfig } from "@/lib/chain";
import { addrUrl } from "@/lib/agent";
import { Panel, Dot } from "@/components/ui";
import { Num } from "@/components/num";

// A live, on-chain view of every stock Aumo holds: the agent's exposure per pool, the oracle price it
// trades on, the day's move, and whether the market is open. Everything here is a single eth_call
// (batched via multicall) plus the day's candles, so it is reliable on X Layer's public RPC — unlike a
// historical event feed, which the RPC's 100-block getLogs cap makes impractical client-side. Full
// per-transaction history lives on the block explorer, linked per pool.

const APP_STOCKS = "https://app.aumo.finance/stocks";
const usd = (p?: number) =>
  p === undefined ? "—" : `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const UP = "#22c55e";
const DOWN = "#ef4444";

type Row = {
  stock: StockConfig;
  ticker: string;
  price?: number;
  open?: boolean;
  nav?: number; // Aumo's exposure in USD (pool NAV)
  change?: number; // day change %
  points: number[]; // day candles for the sparkline
};

// Shared data layer: one multicall for price/market/exposure per pool, plus the day's candles.
function useStockBook() {
  const reads = useReadContracts({
    contracts: liveStocks.flatMap((s) => [
      { address: s.oracle, abi: equityOracleAbi, functionName: "priceWad", args: [s.feedId] } as const,
      { address: s.pool, abi: equityPoolAbi, functionName: "marketOpen" } as const,
      { address: s.pool, abi: equityPoolAbi, functionName: "totalAssets" } as const,
    ]),
    chainId: activeChain.id,
    query: { enabled: liveStocks.length > 0, refetchInterval: 12_000 },
  });

  const [candles, setCandles] = useState<Record<string, { changePct: number; points: number[] }>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        liveStocks.map(async (s) => {
          try {
            const res = await fetch(`/api/candles?symbol=${encodeURIComponent(s.symbol)}&range=1D`);
            if (!res.ok) return null;
            const j = (await res.json()) as { changePct?: number; points?: { c: number }[] };
            if (typeof j.changePct !== "number" || !Array.isArray(j.points)) return null;
            return [s.symbol, { changePct: j.changePct, points: j.points.map((p) => p.c) }] as const;
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) {
        const next: Record<string, { changePct: number; points: number[] }> = {};
        for (const e of entries) if (e) next[e[0]] = e[1];
        setCandles(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: Row[] = useMemo(() => {
    return liveStocks.map((s, i) => {
      const pr = reads.data?.[i * 3]?.result as [bigint, bigint] | undefined;
      const open = reads.data?.[i * 3 + 1]?.result as boolean | undefined;
      const navRaw = reads.data?.[i * 3 + 2]?.result as bigint | undefined;
      const c = candles[s.symbol];
      return {
        stock: s,
        ticker: s.symbol.replace(/x$/, ""),
        price: pr && pr[0] > 0n ? Number(pr[0]) / 1e18 : undefined,
        open,
        nav: navRaw === undefined ? undefined : Number(navRaw) / 1e6,
        change: c?.changePct,
        points: c?.points ?? [],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reads.data, candles]);

  const totalExposure = rows.reduce((t, r) => t + (r.nav ?? 0), 0);
  const anyOpen = rows.some((r) => r.open === true);
  return { rows, totalExposure, anyOpen, loading: reads.isLoading && !reads.data };
}

function Spark({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return <div className="h-9 w-[120px]" />;
  const w = 120,
    h = 36,
    pad = 3;
  const min = Math.min(...points),
    max = Math.max(...points),
    span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const d = points
    .map((c, i) => `${i ? "L" : "M"}${(pad + i * step).toFixed(1)} ${(h - pad - ((c - min) / span) * (h - pad * 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke={up ? UP : DOWN} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Full stock book — the Activity page's Stocks tab. */
export function StockTrack() {
  const { rows, totalExposure, anyOpen, loading } = useStockBook();

  if (liveStocks.length === 0) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-muted-foreground">No stocks are live on this network yet.</p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
          <span className="text-[11px] uppercase tracking-wide text-faint">Stock exposure</span>
          <Num value={totalExposure} currency maximumFractionDigits={0} className="text-2xl font-medium" />
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
          <span className="text-[11px] uppercase tracking-wide text-faint">Stocks live</span>
          <span className="text-2xl font-medium tnum text-foreground">{liveStocks.length}</span>
        </div>
        <div className="col-span-2 flex flex-col gap-1 rounded-lg border border-border bg-card p-4 sm:col-span-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Market</span>
          <span className="flex items-center gap-2 text-lg font-medium text-foreground">
            <Dot tone={anyOpen ? "positive" : "muted"} />
            {anyOpen ? "Open" : "Closed"}
          </span>
        </div>
      </div>

      <ol className="flex flex-col gap-3">
        {rows.map((r) => {
          const up = (r.change ?? 0) >= 0;
          return (
            <li key={r.stock.pool}>
              <Panel className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex min-w-0 items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/brand/stocks/${r.ticker}.png`} alt={r.stock.name} width={36} height={36} className="size-9 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tracking-tight text-foreground">{r.ticker}</span>
                      <span className="truncate text-xs text-muted-foreground">{r.stock.name}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="tnum text-sm text-foreground">{usd(r.price)}</span>
                      {r.change !== undefined ? (
                        <span className="tnum text-xs font-medium" style={{ color: up ? UP : DOWN }}>
                          {up ? "+" : ""}
                          {r.change.toFixed(2)}%
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="hidden sm:block">
                  <Spark points={r.points} up={up} />
                </div>

                <div className="flex items-center justify-between gap-6 sm:justify-end">
                  <div className="flex flex-col sm:items-end">
                    <span className="text-[11px] uppercase tracking-wide text-faint">Aumo holds</span>
                    <span className="tnum text-sm text-foreground">
                      {r.nav === undefined ? "—" : `$${r.nav.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                    </span>
                  </div>
                  <div className="flex flex-col sm:items-end">
                    <span className="text-[11px] uppercase tracking-wide text-faint">Market</span>
                    <span className="flex items-center gap-1.5 text-sm text-foreground">
                      <Dot tone={r.open === false ? "muted" : "positive"} />
                      {r.open === false ? "Closed" : "Open"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <a href={addrUrl(r.stock.pool)} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" title="This pool on the block explorer">
                      Explorer ↗
                    </a>
                    <a href={APP_STOCKS} className="text-xs font-medium text-accent underline-offset-2 hover:underline">
                      Trade
                    </a>
                  </div>
                </div>
              </Panel>
            </li>
          );
        })}
      </ol>

      {loading ? <p className="text-xs text-faint">Loading live prices…</p> : null}
      <p className="text-xs text-faint">
        Prices, exposure and market status are live from the pools. Every deposit, withdrawal and agent
        trade is recorded on-chain — open a pool on the explorer for its full transaction history.
      </p>
    </div>
  );
}

/** Compact stock strip — a dashboard tile. `activityHref` links to the full Stocks tab. */
export function StockStrip({ activityHref }: { activityHref?: string }) {
  const { rows, totalExposure, anyOpen } = useStockBook();
  if (liveStocks.length === 0) return null;

  return (
    <Panel className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          Tokenized stocks
          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <Dot tone={anyOpen ? "positive" : "muted"} />
            {anyOpen ? "Market open" : "Market closed"}
          </span>
        </span>
        <span className="flex flex-col items-end">
          <span className="text-[11px] uppercase tracking-wide text-faint">Exposure</span>
          <Num value={totalExposure} currency maximumFractionDigits={0} className="tnum text-sm font-medium text-foreground" />
        </span>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {rows.map((r) => {
          const up = (r.change ?? 0) >= 0;
          return (
            <li key={r.stock.pool} className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/brand/stocks/${r.ticker}.png`} alt={r.stock.name} width={28} height={28} className="size-7 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-semibold tracking-tight text-foreground">{r.ticker}</span>
                <div className="flex items-center gap-1.5">
                  <span className="tnum text-xs text-muted-foreground">{usd(r.price)}</span>
                  {r.change !== undefined ? (
                    <span className="tnum text-[11px] font-medium" style={{ color: up ? UP : DOWN }}>
                      {up ? "+" : ""}
                      {r.change.toFixed(2)}%
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {activityHref ? (
        <a href={activityHref} className="mt-4 self-start text-xs font-medium text-accent underline-offset-2 hover:underline">
          Track stocks →
        </a>
      ) : null}
    </Panel>
  );
}
