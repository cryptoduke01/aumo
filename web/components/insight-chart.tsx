"use client";

import { useRef, useState } from "react";
import { DitherArea } from "./dither-area";

// An interactive wrapper around the dithered area canvas: a pointer crosshair, a dot pinned to the
// line, and a tooltip reading out the value + label at the hovered sample. The scaling mirrors
// DitherArea exactly (pad = 8, shared min/max) so the dot sits on the drawn line.
export function InsightChart({
  points,
  format,
  height = 150,
}: {
  points: { label: string; value: number }[];
  format: (v: number) => string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [i, setI] = useState<number | null>(null);
  const values = points.map((p) => p.value);
  const n = values.length;

  const pad = 8;
  const min = n ? Math.min(...values) : 0;
  const max = n ? Math.max(...values) : 1;
  const span = max - min || 1;
  const topPct = (v: number) => ((height - pad - ((v - min) / span) * (height - pad * 2)) / height) * 100;

  const onMove = (e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (!el || n < 2) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setI(Math.max(0, Math.min(n - 1, Math.round((x / rect.width) * (n - 1)))));
  };

  const hovered = i != null && n > 1 ? points[i] : null;
  const leftPct = i != null && n > 1 ? (i / (n - 1)) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      className="relative touch-none select-none"
      style={{ height }}
      onPointerMove={onMove}
      onPointerLeave={() => setI(null)}
    >
      <DitherArea values={values} height={height} />
      {hovered ? (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/25"
            style={{ left: `${leftPct}%` }}
          />
          <div
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
            style={{ left: `${leftPct}%`, top: `${topPct(hovered.value)}%` }}
          />
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-center shadow-sm shadow-black/20"
            style={{ left: `${Math.min(86, Math.max(14, leftPct))}%`, top: `${Math.max(16, topPct(hovered.value) - 4)}%` }}
          >
            <div className="tnum text-xs font-medium text-foreground">{format(hovered.value)}</div>
            {hovered.label ? <div className="text-[10px] text-faint">{hovered.label}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
