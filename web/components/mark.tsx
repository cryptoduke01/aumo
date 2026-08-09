// The Aumo mark, rebuilt to the designer's geometry (Frame 9): a stroked vault
// square with the bottom-right corner chamfered — that cut is what turns the box
// into a lowercase "a" — holding a solid deposit block with its own matching
// chamfer. currentColor throughout so it themes gold on dark, ink on cream.
// Swap for the official SVG the moment it lands; the geometry already matches.
export function AumoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* vault outline, chamfered bottom-right */}
      <path
        d="M8 8 H40 V32.5 L32.5 40 H8 Z"
        stroke="currentColor"
        strokeWidth="3.1"
        strokeLinejoin="miter"
      />
      {/* deposit block, matching chamfer, sat up-left of centre like the mark */}
      <path d="M17.5 17 H28 V24.5 L24.5 28 H17.5 Z" fill="currentColor" />
    </svg>
  );
}

export function AumoWordmark({
  className,
  markClass = "size-[1.15em] text-foreground",
}: {
  className?: string;
  markClass?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[1.05rem] font-medium lowercase tracking-tight ${className ?? ""}`}
    >
      <AumoMark className={markClass} />
      <span>aumo</span>
    </span>
  );
}
