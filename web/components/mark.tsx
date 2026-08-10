// The official Aumo mark, straight from the brand kit export. Sovereign gold on transparent, so it
// reads on both Ink and Off-White backgrounds. This is the designer's asset — do not substitute,
// recolour, or redraw it. `className` controls size (e.g. size-4); colour classes are ignored.
export function AumoMark({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/mark-gold.png"
      alt=""
      aria-hidden="true"
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}

export function AumoWordmark({
  className,
  markClass = "size-[1.05em]",
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
