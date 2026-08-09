// Real protocol marks so a user grabs the plot at a glance. Brand-coloured on
// purpose (recognition beats palette purity for third-party logos), kept small
// and tasteful, always paired with the name in text. Hand-built SVG so they stay
// self-contained (no remote images, CSP-safe) and crisp at any size.

// Aave — the ghost, on its teal→magenta gradient.
export function AaveLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="aave-g" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#B6509E" />
          <stop offset="1" stopColor="#2EBAC6" />
        </linearGradient>
      </defs>
      <path
        d="M16 3.5A11.5 11.5 0 0 0 4.5 15v11.6c0 1 1.1 1.6 2 1.1l2.2-1.4 2.4 1.5a1.2 1.2 0 0 0 1.3 0l2.4-1.5 1.2.7 1.2-.7 2.4 1.5a1.2 1.2 0 0 0 1.3 0l2.4-1.5 2.2 1.4c.9.5 2-.1 2-1.1V15A11.5 11.5 0 0 0 16 3.5Z"
        fill="url(#aave-g)"
      />
      <circle cx="11.6" cy="14.5" r="1.9" fill="#fff" />
      <circle cx="20.4" cy="14.5" r="1.9" fill="#fff" />
    </svg>
  );
}

// USDG — Global Dollar. Navy roundel with a globe + dollar stroke.
export function UsdgLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#0A1B3D" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#6E93FF" strokeWidth="1.6" />
      <path d="M16 6.5v19M6.6 16h18.8" stroke="#6E93FF" strokeWidth="1.2" opacity="0.55" />
      <path
        d="M19 12.4c-.7-1-1.9-1.5-3-1.5-1.7 0-3 1-3 2.5 0 3.4 6 2 6 5.4 0 1.5-1.4 2.6-3.1 2.6-1.2 0-2.4-.5-3-1.5"
        fill="none"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M16 9v14" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

// LayerZero — monochrome layered mark (three stacked bars), themes with the ink.
export function LayerZeroLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      <path d="M7 11.5 16 6l9 5.5-9 5.5-9-5.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7 16.5 16 22l9-5.5M7 21 16 26.5 25 21" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

// Uniswap — its pink, with a simple unicorn-horn swoosh.
export function UniswapLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#FF007A" />
      <path
        d="M11 22c-1.8-1.4-2.6-3.6-1.7-6 .8-2.1 2.6-2.9 2.2-5.2 1.9 1.2 1.6 3.2.9 4.7 1.2-.6 1.7-1.9 1.5-3.6 2 1.7 2.6 4.4 1 6.9 1.4-.2 2.2-1.2 2.6-2.6.9 2.6-.3 5.2-2.9 6.4 1.2.2 2.4-.1 3.4-1-.6 2-2.7 3.4-5.2 3.2"
        fill="#fff"
      />
      <circle cx="13" cy="12.6" r="0.8" fill="#FF007A" />
    </svg>
  );
}

// Route a venue/protocol name to its mark. Falls back to null so callers can
// decide (e.g. use the generic VenueIcon glyph instead).
export function BrandLogo({ name, className = "size-4" }: { name: string; className?: string }) {
  const n = name.toLowerCase();
  if (n.includes("aave")) return <AaveLogo className={className} />;
  if (n.includes("usdg") || n.includes("rwa") || n.includes("global dollar")) return <UsdgLogo className={className} />;
  if (n.includes("layerzero") || n.includes("layer zero")) return <LayerZeroLogo className={className} />;
  if (n.includes("uniswap") || n.includes("uni ")) return <UniswapLogo className={className} />;
  return null;
}
