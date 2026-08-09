import Link from "next/link";
import { AumoWordmark } from "./mark";
import { ThemeToggle } from "./theme-toggle";

function ArrowOut({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M5 11L11 5M11 5H6M11 5V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const links = [
  { href: "/#cycle", label: "How it works" },
  { href: "/docs", label: "Docs" },
  { href: "/whitepaper", label: "Whitepaper" },
];

// Marketing chrome shared by the landing and every content page.
export function SiteHeader() {
  return (
    <header className="settle sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center px-5 py-4 sm:px-8">
        <Link href="/" className="shrink-0">
          <AumoWordmark />
        </Link>
        <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-5 md:ml-0">
          <ThemeToggle />
          <Link
            href="/app"
            className="group inline-flex shrink-0 items-center gap-1.5 text-sm text-foreground transition-colors hover:text-muted-foreground"
          >
            Launch app
            <ArrowOut className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
