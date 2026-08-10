// Pure-SVG charts, themeable via CSS vars, no dependency. Values are rounded so
// SSR and client serialize identically (no hydration drift). The area chart moved
// to <DitherArea> (canvas, dithered); this file keeps the donut.
const r3 = (n: number) => Number(n.toFixed(3));

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
