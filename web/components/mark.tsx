// The official Aumo mark (brand-kit shape), rendered as a mask filled with the brand's mark colour
// so it follows the correct variations: Sovereign gold on the Ink (dark) theme, Ink on the
// Off-White (light) theme. One asset, crisp at any size. Do not substitute or redraw the shape.
// `className` controls size (e.g. size-4).
export function AumoMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={{
        backgroundColor: "var(--mark)",
        WebkitMaskImage: "url(/brand/mark-gold.png)",
        maskImage: "url(/brand/mark-gold.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
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
