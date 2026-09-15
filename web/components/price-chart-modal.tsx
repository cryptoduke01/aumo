"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type Point = { t: number; c: number };
type Series = { ticker: string; points: Point[]; first: number; last: number; changePct: number };
const RANGES = ["1D", "1W", "1M"] as const;
type Range = (typeof RANGES)[number];

/** Build line + area SVG paths from a close series, normalized to the given box (with padding). */
function paths(points: Point[], w: number, h: number, pad: number) {
  const xs = points.map((_, i) => (points.length > 1 ? (i / (points.length - 1)) * (w - pad * 2) + pad : w / 2));
  const cs = points.map((p) => p.c);
  const min = Math.min(...cs);
  const max = Math.max(...cs);
  const span = max - min || 1;
  const y = (c: number) => h - pad - ((c - min) / span) * (h - pad * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i]!.toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  const area = `${line} L${xs[xs.length - 1]!.toFixed(1)},${(h - pad).toFixed(1)} L${xs[0]!.toFixed(1)},${(h - pad).toFixed(1)} Z`;
  return { line, area, endX: xs[xs.length - 1]!, endY: y(cs[cs.length - 1]!) };
}

export function PriceChartModal({
  open,
  symbol,
  name,
  logo,
  onClose,
}: {
  open: boolean;
  symbol: string; // xStock symbol, e.g. "NVDAx"
  name: string;
  logo?: string;
  onClose: () => void;
}) {
  const [range, setRange] = useState<Range>("1D");
  const [data, setData] = useState<Series | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Escape to close, scroll lock, focus management (same pattern as the deposit modal).
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => dialogRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
      trigger?.focus?.();
    };
  }, [open, onClose]);

  // Fetch the series when opened or the range changes.
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    setLoading(true);
    setError(false);
    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&range=${range}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: Series) => {
        if (Array.isArray(j.points) && j.points.length > 0) setData(j);
        else setError(true);
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, range, symbol]);

  const up = (data?.changePct ?? 0) >= 0;
  const stroke = up ? "#22c55e" : "#ef4444";
  const W = 700;
  const H = 240;
  const p = data && data.points.length > 1 ? paths(data.points, W, H, 16) : null;
  const gid = `carea-${symbol}`;

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="chart-modal-title"
        >
          <motion.div
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card p-6"
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
            ref={dialogRef}
            tabIndex={-1}
          >
            {/* header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="size-9 rounded-full border border-border/50 object-cover" />
                ) : null}
                <div className="flex flex-col">
                  <span id="chart-modal-title" className="text-sm font-medium text-foreground">
                    {symbol} <span className="text-muted-foreground">· {name}</span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="tnum text-lg font-medium text-foreground">
                      {data ? `$${data.last.toFixed(2)}` : "—"}
                    </span>
                    {data ? (
                      <span className="tnum text-xs font-medium" style={{ color: stroke }}>
                        {up ? "+" : ""}
                        {data.changePct.toFixed(2)}%
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-card-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* chart */}
            <div className="relative mt-5 h-[240px] w-full overflow-hidden rounded-xl border border-border bg-card-2">
              {p ? (
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
                  <defs>
                    <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
                      <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={p.area} fill={`url(#${gid})`} />
                  <path d={p.line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  <circle cx={p.endX} cy={p.endY} r="3.5" fill={stroke} />
                </svg>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {loading ? "Loading…" : error ? "Chart unavailable" : "—"}
                </div>
              )}
            </div>

            {/* ranges */}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex gap-1 rounded-lg border border-border bg-card-2 p-1">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      range === r ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-faint">Underlying: {symbol.replace(/x$/i, "")} · data may be delayed</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
