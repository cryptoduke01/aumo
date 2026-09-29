import Link from "next/link";
import { AumoWordmark } from "./mark";
import s from "./site/footer.module.css";

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4.5 7.5 7.5 5 7.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// App destinations point at the canonical app subdomain (clean URLs, no /app prefix).
const APP = "https://app.aumo.finance";
const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      [APP, "App"],
      [`${APP}/vault`, "Deposit"],
      [`${APP}/venues`, "Venues"],
      [`${APP}/activity`, "Receipts"],
    ],
  },
  {
    title: "Markets",
    links: [
      [`${APP}/stocks`, "Stocks"],
      [`${APP}/basket`, "Basket"],
      [`${APP}/gold`, "Gold"],
    ],
  },
  {
    title: "Learn",
    links: [
      ["/docs", "Docs"],
      ["/research", "Research"],
      ["/whitepaper", "Whitepaper"],
      ["/internals", "Internals"],
    ],
  },
  {
    title: "Company",
    links: [
      ["/ecosystem", "Ecosystem"],
      ["/brand", "Brand"],
      ["mailto:info@aumo.finance", "Contact"],
    ],
  },
];

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (href.startsWith("/")) return <Link href={href}>{children}</Link>;
  return <a href={href}>{children}</a>;
}

export function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className={s.main}>
        <nav className={s.cols} aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <p className={s.colTitle}>{c.title}</p>
              <ul className={s.colList}>
                {c.links.map(([href, label]) => (
                  <li key={label}>
                    <FooterLink href={href}>{label}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <Link href="/" className={s.lockup} aria-label="Aumo home">
          <AumoWordmark className="!text-[1.75rem]" markClass="size-[1.05em]" />
        </Link>
      </div>

      <div className={s.meta}>
        <ul className={s.socials}>
          <li>
            <a href="https://x.com/aumofinance" target="_blank" rel="noreferrer" aria-label="Aumo on X">
              <XIcon />
            </a>
          </li>
          <li>
            <a href="https://github.com/cryptoduke01/aumo" target="_blank" rel="noreferrer" aria-label="Aumo on GitHub">
              <GitHubIcon />
            </a>
          </li>
          <li>
            <a href="mailto:info@aumo.finance" aria-label="Email info@aumo.finance">
              <MailIcon />
            </a>
          </li>
        </ul>
        <span>© 2026 Aumo · Built on X Layer</span>
        <div className={s.legal}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </div>

      <span className={s.wordmark} aria-hidden>
        aumo
      </span>
    </footer>
  );
}
