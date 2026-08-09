// Premium noise: a fine film grain on the substrate, behind content, to kill
// banding on the warm-black surface and give it a physical, printed quality.
// Felt, not seen - very low opacity, sits under everything (-z-10), never over
// text. Static SVG turbulence as a data URI, so no runtime cost.
const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function Grain({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 ${className}`}
      style={{
        backgroundImage: NOISE,
        backgroundRepeat: "repeat",
        opacity: 0.035,
        mixBlendMode: "overlay",
      }}
    />
  );
}
