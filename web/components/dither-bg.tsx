// A dithered texture layer for a section background, following the keryx model: the dither image
// bled through with an optional warm Sovereign glow and faded into the Ink page. Decorative and
// pointer-events-none, sits behind section content (parent must be `relative isolate`).
export function DitherBg({
  src,
  className = "",
  opacity = 0.4,
  glow = true,
  from = "bottom",
}: {
  src: string;
  className?: string;
  opacity?: number;
  glow?: boolean;
  from?: "top" | "bottom" | "center";
}) {
  const mask =
    from === "top"
      ? "linear-gradient(to bottom,#000 0%,transparent 85%)"
      : from === "center"
        ? "radial-gradient(120% 90% at 50% 50%,#000 10%,transparent 72%)"
        : "linear-gradient(to top,#000 0%,transparent 85%)";
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover [filter:saturate(0.85)_contrast(1.05)]"
        style={{ opacity, WebkitMaskImage: mask, maskImage: mask }}
      />
      {glow ? (
        <div
          className="absolute inset-0 mix-blend-soft-light"
          style={{ background: "radial-gradient(60% 60% at 50% 45%, color-mix(in srgb, var(--primary) 24%, transparent), transparent 66%)" }}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/5 to-background/40" />
    </div>
  );
}
