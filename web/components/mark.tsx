// The Aumo mark, rebuilt to the designer's geometry (Frame 9): a stroked vault
// square with the bottom-right corner chamfered - that cut is what turns the box
// into a lowercase "a" - holding a solid deposit block with its own matching
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
        d="M9 9 H39 V31.5 L31.5 39 H9 Z"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinejoin="miter"
      />
      {/* deposit block, matching chamfer, sat just up-left of centre */}
      <path d="M18 18 H29 V25.5 L25.5 29 H18 Z" fill="currentColor" />
    </svg>
  );
}

export function AumoWordmark({
  className,
  markClass = "size-[1.05em] text-primary",
}: {
  className?: string;
  markClass?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[0.42rem] text-[1.05rem] font-medium lowercase tracking-tight ${className ?? ""}`}
    >
      <AumoMark className={markClass} />
      <span>aumo</span>
    </span>
  );
}
