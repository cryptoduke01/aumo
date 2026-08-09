"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./wallet";
import { AumoWordmark } from "./mark";
import { ThemeToggle } from "./theme-toggle";

const tabs = [
  { href: "/app", label: "Overview" },
  { href: "/app/vault", label: "Deposit" },
  { href: "/app/venues", label: "Venues" },
  { href: "/app/activity", label: "Activity" },
  { href: "/docs", label: "Docs" },
];

export function AppNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link href="/" className="shrink-0">
          <AumoWordmark markClass="size-[1.15em] text-foreground" />
        </Link>
        <nav className="hidden items-center gap-6 sm:flex">
          {tabs.map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`text-sm transition-colors ${
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <ThemeToggle />
          <ConnectButton />
        </div>
      </div>
      {/* mobile tabs */}
      <nav className="flex items-center gap-5 overflow-x-auto border-t border-border px-5 py-2.5 sm:hidden">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`shrink-0 text-sm ${active ? "text-foreground" : "text-muted-foreground"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
