// Small, on-brand glyphs for known venues so names read at a glance. Monochrome
// (currentColor) to sit inside the gold/ink palette rather than clash with it.
// Extend the switch as venues are added.
export function VenueIcon({ name, className = "size-4" }: { name: string; className?: string }) {
  const n = name.toLowerCase();

  if (n.includes("aave")) {
    // Simplified Aave "ghost" mark.
    return (
      <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
        <path
          d="M4 9.5a6 6 0 0 1 12 0V16l-2-1.4L12 16l-2-1.4L8 16l-2-1.4Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="9.5" r="0.9" fill="currentColor" />
        <circle cx="12" cy="9.5" r="0.9" fill="currentColor" />
      </svg>
    );
  }

  if (n.includes("usdg") || n.includes("rwa")) {
    // Dollar-in-a-ring for the RWA-backed dollar.
    return (
      <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7.3" stroke="currentColor" strokeWidth="1.3" />
        <path d="M10 5.5v9M12 7.4c-.5-.7-1.3-1-2-1-1.1 0-2 .7-2 1.7 0 2.3 4 1.4 4 3.7 0 1-.9 1.7-2 1.7-.8 0-1.6-.4-2-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }

  // Generic venue: the vault block.
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path d="M4 4h9l3 3v9H4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 8h4v4l-1.5 1.5H8Z" fill="currentColor" />
    </svg>
  );
}
