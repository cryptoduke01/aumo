"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AumoWordmark } from "./mark";
import { MenuButton } from "./menu-button";
import { ThemeToggle } from "./theme-toggle";
import s from "./site/nav.module.css";
import site from "./site/site.module.css";

const APP = "https://app.aumo.finance";

export function ArrowUpRight({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M5 11L11 5M11 5H6M11 5V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Primary = { href: string; label: string; tag: string };
type Secondary = { href: string; label: string; meta: string };
type Group = {
  key: string;
  label: string;
  kicker: string;
  primary: Primary[];
  sideTitle: string;
  sideBody: string;
  secondary: Secondary[];
};

const GROUPS: Group[] = [
  {
    key: "product",
    label: "Product",
    kicker: "The agent",
    primary: [
      { href: `${APP}/vault`, label: "Stablecoin yield", tag: "USDT0 across Aave, USDG, Pendle and Uniswap fees" },
      { href: APP, label: "Ask Aumo", tag: "Question the agent about any move it made" },
      { href: `${APP}/activity`, label: "Receipts", tag: "Every decision, bound to the policy that allowed it" },
    ],
    sideTitle: "An agent inside a contract",
    sideBody:
      "The agent scores venues and moves funds. The contract decides how far it can go: it cannot exceed a cap, touch an unlisted venue, or send money anywhere except back to the pool.",
    secondary: [
      { href: `${APP}/venues`, label: "Venues", meta: "Live" },
      { href: `${APP}/insights`, label: "Insights", meta: "Agent" },
    ],
  },
  {
    key: "markets",
    label: "Markets",
    kicker: "Opt-in pools",
    primary: [
      { href: `${APP}/stocks`, label: "Tokenized stocks", tag: "NVIDIA, Apple, Microsoft and Meta" },
      { href: `${APP}/basket`, label: "Diversified basket", tag: "All four at equal weight, rebalanced on drift" },
      { href: `${APP}/gold`, label: "Tokenized gold", tag: "PAXGy, gold that grows its own entitlement" },
    ],
    sideTitle: "Isolated, and at risk by design",
    sideBody:
      "Each market is its own pool under the same guardrails. They hold price exposure you chose, so they are not capital preservation, and the contract only trades them while the market is open.",
    secondary: [{ href: "/research", label: "Why a basket", meta: "Backtest" }],
  },
  {
    key: "resources",
    label: "Resources",
    kicker: "Read the system",
    primary: [
      { href: "/docs", label: "Docs", tag: "How Aumo works, end to end" },
      { href: "/research", label: "Research", tag: "Backtests, method and the numbers" },
      { href: "/whitepaper", label: "Whitepaper", tag: "The design, version 0.6" },
      { href: "/internals", label: "Internals", tag: "Architecture and the self-audit" },
    ],
    sideTitle: "Built in the open",
    sideBody: "The contracts, the agent and this site are open source. Read the code the guardrails come from.",
    secondary: [
      { href: "https://github.com/cryptoduke01/aumo", label: "GitHub", meta: "Source" },
      { href: "/ecosystem", label: "Ecosystem", meta: "X Layer" },
      { href: "/brand", label: "Brand", meta: "Assets" },
    ],
  },
];

function isExternal(href: string) {
  return href.startsWith("http");
}

function NavLink({ href, className, children, onClick }: { href: string; className?: string; children: React.ReactNode; onClick?: () => void }) {
  if (isExternal(href)) {
    return (
      <a href={href} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

// The marketing nav. `overlay` is fixed over the home hero, clear at the top and glass once the page
// scrolls; `solid` is sticky glass on content pages. Desktop triggers open a full-width Ink mega menu on hover or click.
export function SiteHeader({ variant = "solid" }: { variant?: "overlay" | "solid" }) {
  const [active, setActive] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const group = GROUPS.find((g) => g.key === active) ?? null;
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setActive(null), 140);
  };

  useEffect(() => {
    setActive(null);
    setSheet(false);
  }, [pathname]);

  // the home nav floats clear over the hero, then frosts into glass once the page moves
  useEffect(() => {
    if (variant !== "overlay") return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [variant]);

  useEffect(() => {
    if (!active && !sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActive(null);
        setSheet(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, sheet]);

  useEffect(() => {
    document.documentElement.style.overflow = sheet ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [sheet]);

  const open = Boolean(group) || sheet;

  return (
    <header
      className={`${s.shell} ${variant === "overlay" ? s.overlay : s.solid} ${open ? s.open : ""}`}
      data-scrolled={variant === "overlay" && scrolled ? "" : undefined}
      onMouseLeave={scheduleClose}
      onMouseEnter={cancelClose}
    >
      <div className={s.nav}>
        <Link href="/" className={s.brand} aria-label="Aumo home">
          <AumoWordmark markClass="size-[1.05em]" />
        </Link>

        <nav className={s.links} aria-label="Primary">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              className={s.trigger}
              data-active={active === g.key ? "" : undefined}
              aria-expanded={active === g.key}
              onMouseEnter={() => {
                cancelClose();
                setActive(g.key);
              }}
              onFocus={() => setActive(g.key)}
              onClick={() => setActive((a) => (a === g.key ? null : g.key))}
            >
              {g.label}
            </button>
          ))}
        </nav>

        <div className={s.actions}>
          <ThemeToggle className={s.toggle} />
          <Link href="/docs" className={`${site.pillGhost} ${s.hideMobile}`}>
            Docs
          </Link>
          <a href={APP} className={`${site.pill} ${s.hideMobile}`}>
            Launch app
            <ArrowUpRight className={site.pillArrow} />
          </a>
          <MenuButton open={sheet} onClick={() => setSheet((o) => !o)} className={s.menuButton} />
        </div>
      </div>

      {group && (
        <>
          <div className={s.backdrop} aria-hidden onMouseEnter={scheduleClose} onClick={() => setActive(null)} />
          <div className={s.mega} key={group.key}>
            <div className={s.megaInner}>
              <div>
                <p className={s.kicker}>{group.kicker}</p>
                <div className={s.primaryList}>
                  {group.primary.map((p) => (
                    <NavLink key={p.label} href={p.href} className={s.primaryLink}>
                      <span className={s.primaryLabel}>
                        {p.label}
                        <ArrowUpRight className={s.arrow} />
                      </span>
                      <span className={s.primaryTag}>{p.tag}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
              <div className={s.side}>
                <p className={s.sideTitle}>{group.sideTitle}</p>
                <p className={s.sideBody}>{group.sideBody}</p>
                <div className={s.secondaryList}>
                  {group.secondary.map((l) => (
                    <NavLink key={l.label} href={l.href} className={s.secondaryLink}>
                      <span>{l.label}</span>
                      <span className={s.secondaryMeta}>{l.meta}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {sheet && (
        <div className={s.sheet}>
          {GROUPS.map((g) => (
            <div key={g.key} className={s.sheetGroup}>
              <p className={s.kicker}>{g.label}</p>
              {g.primary.map((p) => (
                <NavLink key={p.label} href={p.href} className={s.sheetLink} onClick={() => setSheet(false)}>
                  {p.label}
                </NavLink>
              ))}
            </div>
          ))}
          <div className={s.sheetActions}>
            <a href={APP} className={site.pill}>
              Launch app
              <ArrowUpRight className={site.pillArrow} />
            </a>
            <Link href="/docs" className={site.pillGhost} onClick={() => setSheet(false)}>
              Docs
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
