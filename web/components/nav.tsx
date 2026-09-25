"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ConnectButton } from "./wallet";
import { AumoWordmark } from "./mark";
import { ThemeToggle } from "./theme-toggle";
import { MenuButton } from "./menu-button";
import { useAppBase } from "@/lib/use-app-base";

// App routes live under /app/*, but on the app subdomain the middleware serves them at the root,
// so links there should omit the redundant /app. `seg` is the clean segment; the base prefix is
// added only off the app host.
type Tab = { seg: string; label: string; children?: { seg: string; label: string }[] };
const tabs: Tab[] = [
  { seg: "", label: "Overview" },
  { seg: "/vault", label: "Deposit" },
  { seg: "/venues", label: "Venues" },
  {
    seg: "/stocks",
    label: "Markets",
    children: [
      { seg: "/stocks", label: "Individual stocks" },
      { seg: "/basket", label: "Diversified basket" },
      { seg: "/gold", label: "Gold" },
    ],
  },
  { seg: "/activity", label: "Activity" },
];

export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false); // allow the wallet dropdown to escape the clip once open
  const base = useAppBase(); // "" on the app subdomain (clean URLs), "/app" elsewhere
  const hrefFor = (seg: string) => `${base}${seg}` || "/";
  // Normalise the current path so active-state is correct whether or not /app is in the URL.
  const clean = pathname.replace(/^\/app/, "") || "/";
  const isActive = (seg: string) => (seg === "" ? clean === "/" : clean.startsWith(seg));
  const tabActive = (t: Tab) => isActive(t.seg) || (t.children?.some((c) => isActive(c.seg)) ?? false);
  const toggle = () =>
    setOpen((o) => {
      if (o) setExpanded(false);
      return !o;
    });

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link href="/" className="shrink-0">
          <AumoWordmark markClass="size-[1.15em] text-primary" />
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-7 md:flex">
          {tabs.map((t) => {
            const active = tabActive(t);
            const indicator = active && (
              <motion.span
                layoutId="app-tab-indicator"
                className="absolute inset-x-0 -bottom-[15px] h-px bg-foreground"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            );
            if (t.children) {
              return (
                <div key={t.seg} className="group relative py-1">
                  <span
                    className={`inline-flex cursor-default items-center gap-1 text-sm ${
                      active ? "text-foreground" : "text-muted-foreground transition-colors group-hover:text-foreground"
                    }`}
                  >
                    {t.label}
                    <svg viewBox="0 0 12 12" className="size-3 opacity-60" fill="none" aria-hidden>
                      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  {indicator}
                  {/* hover dropdown; pt-3 keeps the hover target continuous with the trigger */}
                  <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100">
                    <div className="flex min-w-[190px] flex-col rounded-lg border border-border bg-background p-1 shadow-lg">
                      {t.children.map((c) => (
                        <Link
                          key={c.seg}
                          href={hrefFor(c.seg)}
                          className={`rounded-md px-3 py-2 text-sm transition-colors ${
                            isActive(c.seg) ? "bg-card-2 text-foreground" : "text-muted-foreground hover:bg-card-2/50 hover:text-foreground"
                          }`}
                        >
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <Link key={t.seg} href={hrefFor(t.seg)} className="relative py-1 text-sm">
                <span className={active ? "text-foreground" : "text-muted-foreground transition-colors hover:text-foreground"}>
                  {t.label}
                </span>
                {indicator}
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
                if (t.children) {
                  return (
                    <div key={t.seg} className="border-b border-border/60 py-3 last:border-0">
                      <span className="text-xs uppercase tracking-wide text-faint">{t.label}</span>
                      <div className="mt-1 flex flex-col">
                        {t.children.map((c) => (
                          <Link
                            key={c.seg}
                            href={hrefFor(c.seg)}
                            onClick={() => setOpen(false)}
                            className={`py-2 text-sm ${isActive(c.seg) ? "text-foreground" : "text-muted-foreground"}`}
                          >
                            {c.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                }
                const active = isActive(t.seg);
                return (
                  <Link
                    key={t.seg}
                    href={hrefFor(t.seg)}
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
