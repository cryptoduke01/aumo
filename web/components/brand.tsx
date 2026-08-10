// Real, official protocol/token logos, vendored into /public/brand so they are self-contained
// (no remote hotlinking, can't silently break) and unmistakably the actual brands, not
// look-alikes. Aave is the official SVG mark; USDG and LayerZero are the official token logos.
// Rendered as small tiles so their baked backgrounds sit cleanly on either theme.

type Brand = { src: string; alt: string; round: string };

// Order matters: first match wins.
const BRANDS: { test: (n: string) => boolean; brand: Brand }[] = [
  { test: (n) => n.includes("aave"), brand: { src: "/brand/aave.svg", alt: "Aave", round: "rounded-md" } },
  {
    test: (n) => n.includes("usdg") || n.includes("global dollar"),
    brand: { src: "/brand/usdg.png", alt: "USDG (Global Dollar)", round: "rounded-full" },
  },
  {
    test: (n) => n.includes("layerzero") || n.includes("layer zero"),
    brand: { src: "/brand/layerzero.jpeg", alt: "LayerZero", round: "rounded-md" },
  },
];

/** The real logo for a known protocol/token, or null so the caller can fall back to a glyph. */
export function BrandLogo({ name, className = "size-4" }: { name: string; className?: string }) {
  const hit = BRANDS.find((b) => b.test(name.toLowerCase()));
  if (!hit) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={hit.brand.src}
      alt={hit.brand.alt}
      className={`${className} ${hit.brand.round} shrink-0 object-contain`}
    />
  );
}

/** Convenience for the bridge "Powered by LayerZero" credit. */
export function LayerZeroLogo({ className = "size-4" }: { className?: string }) {
  return <BrandLogo name="layerzero" className={className} />;
}
