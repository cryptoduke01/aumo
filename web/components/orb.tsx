// A dotted thinking-orb / spinner for agent + loading states. A ring of dots
// with a comet-tail opacity gradient that rotates. Reduced-motion shows it still.
// No dependency; pure SVG. Inspired by the "thinking orbs" pattern for agent UIs.
export function Orb({
  className = "",
  dots = 12,
}: {
  className?: string;
  dots?: number;
}) {
  const c = 12;
  const r = 8;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g className="orb-spin">
        {Array.from({ length: dots }).map((_, i) => {
          const a = (i / dots) * Math.PI * 2;
          // Round so SSR and client serialize identical strings (no hydration drift).
          const x = (c + r * Math.cos(a)).toFixed(3);
          const y = (c + r * Math.sin(a)).toFixed(3);
          const opacity = (0.12 + 0.88 * (i / (dots - 1))).toFixed(3);
          return (
            <circle key={i} cx={x} cy={y} r={1.5} fill="currentColor" opacity={opacity} />
          );
        })}
      </g>
    </svg>
  );
}
