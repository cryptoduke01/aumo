// A tiny SVG sparkline built from real series data (no dependency). Used for the
// agent's recent risk-adjusted yield across cycles. Draws a line, a soft area
// fill in the accent, and a dot on the latest point.
export function Sparkline({
  values,
  className = "",
  height = 48,
}: {
  values: number[];
  className?: string;
  height?: number;
}) {
  const W = 240;
  const H = height;
  const pad = 4;
  if (!values || values.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none" aria-hidden>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--border)" strokeWidth={1} />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none" aria-hidden>
      <path d={area} fill="var(--accent)" opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lx} cy={ly} r={2.4} fill="var(--accent)" />
    </svg>
  );
}
