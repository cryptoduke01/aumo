"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ConnectButton } from "./wallet";
import { AumoWordmark } from "./mark";
import { ThemeToggle } from "./theme-toggle";
import { MenuButton } from "./menu-button";

const tabs = [
  { href: "/app", label: "Overview" },
  { href: "/app/vault", label: "Deposit" },
  { href: "/app/venues", label: "Venues" },
  { href: "/app/activity", label: "Activity" },
  { href: "/docs", label: "Docs" },
];

export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false); // allow the wallet dropdown to escape the clip once open
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const toggle = () =>
    setOpen((o) => {
      if (o) setExpanded(false);
      return !o;
    });

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link href="/" className="shrink-0">
          <AumoWordmark markClass="size-[1.15em] text-foreground" />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {tabs.map((t) => {
            const active = isActive(t.href);
            return (
              <Link key={t.href} href={t.href} className="relative py-1 text-sm">
                <span className={active ? "text-foreground" : "text-muted-foreground transition-colors hover:text-foreground"}>
                  {t.label}
                </span>
                {active && (
                  <motion.span
                    layoutId="app-tab-indicator"
                    className="absolute inset-x-0 -bottom-[15px] h-px bg-foreground"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <div className="hidden md:block">
            <ConnectButton />
          </div>
          <MenuButton open={open} onClick={toggle} className="md:hidden" />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
            onAnimationComplete={() => setExpanded(open)}
            style={{ overflow: expanded ? "visible" : "hidden" }}
            className="border-t border-border md:hidden"
          >
            <div className="flex flex-col px-5 py-2">
              {tabs.map((t) => {
                const active = isActive(t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    onClick={() => setOpen(false)}
                    className={`border-b border-border/60 py-3 text-sm last:border-0 ${active ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {t.label}
                  </Link>
                );
              })}
              <div className="py-3">
                <ConnectButton />
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
