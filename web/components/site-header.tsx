"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AumoWordmark } from "./mark";
import { ThemeToggle } from "./theme-toggle";
import { MenuButton } from "./menu-button";

function ArrowOut({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M5 11L11 5M11 5H6M11 5V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const links = [
  { href: "/#cycle", label: "How it works" },
  { href: "/docs", label: "Docs" },
  { href: "/whitepaper", label: "Whitepaper" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="settle sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center px-5 py-4 sm:px-8">
        <Link href="/" className="shrink-0">
          <AumoWordmark />
        </Link>
        <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-5 md:ml-0">
          <ThemeToggle />
          <a href="https://app.aumo.finance" className="group hidden shrink-0 items-center gap-1.5 text-sm text-foreground transition-colors hover:text-muted-foreground md:inline-flex">
            Launch app
            <ArrowOut className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
          <MenuButton open={open} onClick={() => setOpen((o) => !o)} className="md:hidden" />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
            className="overflow-hidden border-t border-border/70 md:hidden"
          >
            <div className="flex flex-col px-5 py-2">
              {links.map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="border-b border-border/60 py-3 text-sm text-muted-foreground">
                  {l.label}
                </Link>
              ))}
              <a href="https://app.aumo.finance" onClick={() => setOpen(false)} className="py-3 text-sm font-medium text-foreground">
                Launch app →
              </a>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
