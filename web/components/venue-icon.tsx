// A venue's mark. Prefer the real protocol logo (Aave, USDG, …) so users grab
// the plot instantly; fall back to a monochrome vault glyph for anything else.
import { BrandLogo } from "./brand";

export function VenueIcon({ name, className = "size-4" }: { name: string; className?: string }) {
  const brand = BrandLogo({ name, className });
  if (brand) return brand;

  // Generic venue: the vault block.
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path d="M4 4h9l3 3v9H4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 8h4v4l-1.5 1.5H8Z" fill="currentColor" />
    </svg>
  );
}
