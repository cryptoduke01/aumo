import Link from "next/link";
import { AumoWordmark } from "./mark";
import { DitherBg } from "./dither-bg";

function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MailIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4.5 7.5 7.5 5 7.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

// Aligned, grouped footer on one grid. Sits at the bottom of the page (mt-auto in the flex layout).
export function SiteFooter() {
  return (
    <footer className="relative isolate mt-auto overflow-hidden border-t border-border/70">
      <DitherBg src="/dither-images/HMtauliaQAAqwjB.jpeg" from="top" opacity={0.22} />
      <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="col-span-2 sm:col-span-1">
            <AumoWordmark />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Autonomous, guardrailed stablecoin yield on X Layer.
            </p>
            <span className="mt-4 inline-flex items-center gap-2 text-xs text-faint">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/xlayer.jpg" alt="" className="size-4 rounded" />
              Built on X Layer
            </span>
          </div>
          <Col label="Product" links={product} />
          <Col label="Learn" links={learn} />
        </div>
        <div className="mt-12 flex items-center justify-between border-t border-border/60 pt-6 text-xs text-faint">
          <span>© 2026 Aumo</span>
          <div className="flex items-center gap-4">
            <a
              href="mailto:info@aumo.finance"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              aria-label="Email info@aumo.finance"
            >
              <MailIcon className="size-4" />
              <span className="hidden sm:inline">info@aumo.finance</span>
            </a>
            <a
              href="https://x.com/aumofinance"
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-8 items-center justify-center rounded-lg border border-border transition-colors hover:border-foreground/40 hover:text-foreground"
              aria-label="Aumo on X"
            >
              <XIcon className="size-3.5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
