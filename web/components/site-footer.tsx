import Link from "next/link";

const nav: { href: string; label: string; ext?: boolean }[] = [
  { href: "/docs", label: "Docs" },
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "/app", label: "App" },
  { href: "/app/activity", label: "Activity" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "https://x.com/aumofinance", label: "X", ext: true },
  { href: "https://github.com/cryptoduke01/aumo", label: "GitHub", ext: true },
];

// Shared footer: a tight, intentional link row and colophon, closed by the
// oversized wordmark bleeding off the bottom edge (on top of the surface, not
// buried behind it) — the page's signature, composed rather than dropped in.
export function SiteFooter() {
  return (
    <footer className="relative isolate mt-auto overflow-hidden border-t border-border/70">
      <div className="mx-auto w-full max-w-6xl px-5 pt-16 sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-xs text-sm text-muted-foreground">
            The autonomous treasury for stablecoins. Real yield, on-chain
            guardrails, every move proved.
          </p>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            {nav.map((l) =>
              l.ext ? (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.label}
                  href={l.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {l.label}
                </Link>
              ),
            )}
          </nav>
        </div>
        <div className="mt-12 flex items-center justify-between border-t border-border/60 py-6 font-mono text-xs text-faint">
          <span>© 2026 Aumo</span>
          <span>USDT0 · Aave · LayerZero · X Layer</span>
        </div>
      </div>
      {/* oversized wordmark, anchored flush to the bottom, bleeding off */}
      <div aria-hidden className="flex select-none justify-center overflow-hidden">
        <span className="translate-y-[20%] text-[26vw] font-medium leading-none tracking-[-0.03em] text-foreground/[0.08]">
          aumo
        </span>
      </div>
    </footer>
  );
}
