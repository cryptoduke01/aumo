// Pure-SVG charts, themeable via CSS vars, no dependency. Values are rounded so
// SSR and client serialize identically (no hydration drift).
import { Orb } from "./orb";

const r3 = (n: number) => Number(n.toFixed(3));

export function AreaChart({
  values,
  className = "",
  height = 120,
}: {
  values: number[];
  className?: string;
  height?: number;
}) {
  const W = 320;
  const H = height;
  const pad = 10;
  if (!values || values.length < 2) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2.5 ${className}`} style={{ height: H }}>
        <Orb className="size-5 text-accent" />
        <span className="text-[11px] text-faint">Collecting cycle data…</span>
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => r3((i / (values.length - 1)) * W);
  const y = (v: number) => r3(H - pad - ((v - min) / span) * (H - pad * 2));
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const [lx, ly] = pts[pts.length - 1];
  const grid = [0.25, 0.5, 0.75].map((g) => r3(pad + g * (H - pad * 2)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none" aria-hidden>
      {grid.map((gy, i) => (
        <line key={i} x1={0} y1={gy} x2={W} y2={gy} stroke="var(--border)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      ))}
      <path d={area} fill="var(--accent)" opacity={0.1} />
      <path
        className="chart-draw"
        pathLength={1}
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lx} cy={ly} r={2.6} fill="var(--accent)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export type Segment = { label: string; value: number; tone: string };

export function Donut({
  segments,
  className = "",
  centerLabel,
  centerSub,
}: {
  segments: Segment[];
  className?: string;
  centerLabel?: string;
  centerSub?: string;
}) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let cum = 0;
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx={50} cy={50} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={11} />
        {segments.map((s, i) => {
          const len = r3((s.value / total) * C);
          const off = r3(-cum);
          cum += len;
          return (
            <circle
              key={i}
              cx={50}
              cy={50}
              r={R}
              fill="none"
              stroke={s.tone}
              strokeWidth={11}
              strokeDasharray={`${len} ${r3(C - len)}`}
              strokeDashoffset={off}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      {centerLabel ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-lg font-medium leading-none text-foreground">{centerLabel}</span>
          {centerSub ? <span className="mt-1 text-[10px] text-faint">{centerSub}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
