"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./wallet";

const tabs = [
  { href: "/app", label: "Overview" },
  { href: "/app/vault", label: "Deposit" },
  { href: "/app/activity", label: "Activity" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="text-primary" aria-hidden>▲</span>
            <span className="text-base font-semibold tracking-tight">Aumo</span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {tabs.map((t) => {
              const active = pathname === t.href;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <ConnectButton />
      </div>
      <nav className="flex items-center gap-1 border-t border-border px-4 py-2 sm:hidden">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`rounded-md px-3 py-1.5 text-sm ${
                active ? "bg-card text-foreground" : "text-muted-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
