import Link from "next/link";
import { AumoWordmark } from "./mark";

// App destinations point at the canonical app subdomain (clean URLs, no /app prefix); these are
// absolute so they resolve the same from the marketing site and the app.
const APP = "https://app.aumo.finance";
const product: [string, string][] = [
  [`${APP}`, "App"],
  [`${APP}/vault`, "Deposit"],
  [`${APP}/venues`, "Venues"],
  [`${APP}/activity`, "Activity"],
];
const learn: [string, string][] = [
  ["/docs", "Docs"],
  ["/whitepaper", "Whitepaper"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
];

function Col({ label, links }: { label: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] uppercase tracking-[0.14em] text-faint">
        {label}
      </span>
      {links.map(([href, l]) => (
        <Link
          key={href}
          href={href}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {l}
        </Link>
      ))}
    </div>
  );
}

// Aligned, grouped footer on one grid. Nothing flung to the edges. Closed by the
// oversized wordmark bleeding off the bottom, on top of the surface.
export function SiteFooter() {
  return (
    <footer className="relative isolate mt-auto overflow-hidden border-t border-border/70">
      <div className="mx-auto w-full max-w-6xl px-5 pt-16 sm:px-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-1">
            <AumoWordmark />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Autonomous, guardrailed stablecoin yield on X Layer.
            </p>
          </div>
          <Col label="Product" links={product} />
          <Col label="Learn" links={learn} />
        </div>
        <div className="mt-14 flex items-center justify-between border-t border-border/60 py-6 text-xs text-faint">
          <span>© 2026 Aumo</span>
          <div className="flex items-center gap-5">
            <a href="https://x.com/aumofinance" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">X</a>
          </div>
        </div>
      </div>
      {/* oversized wordmark, anchored flush to the bottom, bleeding off */}
      <div aria-hidden className="flex select-none justify-center overflow-hidden">
        <span className="translate-y-[20%] text-[26vw] font-medium leading-none tracking-[-0.03em] text-foreground/[0.07]">
          aumo
        </span>
      </div>
    </footer>
  );
}
