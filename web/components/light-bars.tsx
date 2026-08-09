// Warm gold vertical light-streak backdrop for the hero (the Ornn motif, in Aumo's gold).
// Deterministic per-bar variation so SSR and client render identically. Purely decorative.
export function LightBars({ className = "" }: { className?: string }) {
  const bars = Array.from({ length: 22 });
  const fade =
    "linear-gradient(180deg, transparent 0%, black 22%, black 68%, transparent 100%)";
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      <div className="flex h-full w-full">
        {bars.map((_, i) => {
          const r = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1); // deterministic 0..1
          const opacity = 0.05 + r * 0.22;
          const peak = 42 + r * 22;
          const blur = 7 + r * 11;
          return (
            <div key={i} className="flex h-full flex-1 justify-center">
              <div
                style={{
                  width: "42%",
                  height: "100%",
                  filter: `blur(${blur}px)`,
                  background: `linear-gradient(180deg, transparent 0%, rgba(190,150,92,${opacity}) ${peak - 16}%, rgba(212,172,104,${opacity * 1.35}) ${peak}%, rgba(190,150,92,${opacity}) ${peak + 16}%, transparent 100%)`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
