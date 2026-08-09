// Interim reproduction of the Aumo mark ("safe box with a job" — vault outline + inner deposit
// block, chamfered bottom-right corner that also reads as a lowercase "a"). currentColor so it
// themes gold/cream. Swap for the designer's official SVG when it lands.
export function AumoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M22 14 H80 a6 6 0 0 1 6 6 V63 L63 86 H20 a6 6 0 0 1-6-6 V20 a6 6 0 0 1 6-6 Z"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path d="M40 34 H60 V52 L52 60 H40 Z" fill="currentColor" />
    </svg>
  );
}

export function AumoWordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <AumoMark className="size-5 text-primary" />
      <span className="text-base font-semibold tracking-tight lowercase">aumo</span>
    </span>
  );
}
