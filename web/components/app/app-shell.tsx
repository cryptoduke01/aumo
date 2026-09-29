"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AumoWordmark } from "../mark";
import { ConnectButton } from "../wallet";
import { ThemeToggle } from "../theme-toggle";
import { MenuButton } from "../menu-button";
import { useAppBase } from "@/lib/use-app-base";
import { getStatus, timeAgo, type Status } from "@/lib/agent";
import s from "./app-shell.module.css";

const SITE = "https://aumo.finance";

// Line icons for the rail, drawn on a 20px grid with one stroke weight.
const ICONS: Record<string, ReactNode> = {
  overview: <path d="M3.5 3.5h5.5v5.5H3.5zM11 3.5h5.5v5.5H11zM3.5 11h5.5v5.5H3.5zM11 11h5.5v5.5H11z" />,
  deposit: <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M3.5 12.5v3.5h13v-3.5" />,
  venues: <path d="m10 3 7 3.5-7 3.5-7-3.5L10 3Zm-7 7 7 3.5 7-3.5M3 13.5 10 17l7-3.5" />,
  activity: <path d="M2.5 10h3.5l2-5 4 10 2-5h3.5" />,
  stocks: <path d="M3 15.5 7.5 11l3 3L17 7.5M17 7.5h-4M17 7.5v4" />,
  basket: <path d="M10 3a7 7 0 1 0 7 7h-7V3Zm2 0v5h5a7 7 0 0 0-5-5Z" />,
  gold: <path d="M5.5 8h9l2.5 7.5H3L5.5 8Zm2-3.5h5L14 8H6l1.5-3.5Z" />,
  settings: <path d="M4 6h8m3 0h1M4 14h2m3 0h7M12 4v4M7 12v4" />,
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

type Item = { seg: string; label: string; icon: string; section: string };
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Treasury",
    items: [
      { seg: "", label: "Overview", icon: "overview", section: "Treasury" },
      { seg: "/vault", label: "Deposit", icon: "deposit", section: "Treasury" },
      { seg: "/venues", label: "Venues", icon: "venues", section: "Treasury" },
      { seg: "/activity", label: "Activity", icon: "activity", section: "Treasury" },
    ],
  },
  {
    label: "Markets",
    items: [
      { seg: "/stocks", label: "Stocks", icon: "stocks", section: "Markets" },
      { seg: "/basket", label: "Basket", icon: "basket", section: "Markets" },
      { seg: "/gold", label: "Gold", icon: "gold", section: "Markets" },
    ],
  },
  {
    label: "Account",
    items: [{ seg: "/settings", label: "Settings", icon: "settings", section: "Account" }],
  },
];
const ALL = GROUPS.flatMap((g) => g.items);

// The agent's heartbeat, polled from its public status endpoint.
function useAgentStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      getStatus(ctrl.signal)
        .then((st) => {
          setStatus(st);
          setDown(false);
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setDown(true);
        });
    load();
    const id = setInterval(load, 30000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, []);
  return { status, down };
}

function Nav({ hrefFor, isActive, onNavigate }: { hrefFor: (seg: string) => string; isActive: (seg: string) => boolean; onNavigate?: () => void }) {
  return (
    <>
      {GROUPS.map((g) => (
        <nav key={g.label} className={s.group} aria-label={g.label}>
          <span className={s.groupLabel}>{g.label}</span>
          {g.items.map((it) => (
            <Link
              key={it.seg}
              href={hrefFor(it.seg)}
              className={s.item}
              data-active={isActive(it.seg) ? "" : undefined}
              aria-current={isActive(it.seg) ? "page" : undefined}
              onClick={onNavigate}
            >
              <Icon name={it.icon} />
              {it.label}
            </Link>
          ))}
        </nav>
      ))}
    </>
  );
}

function AgentCard({ href, status, down }: { href: string; status: Status | null; down: boolean }) {
  const total = status?.decisions?.total;
  return (
    <Link href={href} className={s.agent}>
      <span className={s.agentHead}>
        Agent
        <span className={s.state}>
          <i className={s.pulse} data-down={down ? "" : undefined} aria-hidden />
          {down ? "Unreachable" : "Online"}
        </span>
      </span>
      <span className={s.agentFigure}>{total != null ? total.toLocaleString("en-US") : "—"}</span>
      <span className={s.agentMeta}>
        <span>decisions recorded</span>
        <span className="capitalize">{status?.latest?.regime ?? ""}</span>
      </span>
      <span className={s.agentMeta}>
        <span>Last decision</span>
        <span>{status?.latest?.takenAt ? timeAgo(status.latest.takenAt) : "—"}</span>
      </span>
    </Link>
  );
}

// The app frame: rail + working column. Every /app route renders inside it.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const base = useAppBase(); // "" on the app subdomain (clean URLs), "/app" elsewhere
  const hrefFor = (seg: string) => `${base}${seg}` || "/";
  const clean = pathname.replace(/^\/app/, "") || "/";
  const isActive = (seg: string) => (seg === "" ? clean === "/" : clean.startsWith(seg));
  const current = ALL.find((it) => isActive(it.seg));
  const [sheet, setSheet] = useState(false);
  const { status, down } = useAgentStatus();

  useEffect(() => setSheet(false), [pathname]);

  return (
    <div className={s.frame}>
      <aside className={s.rail}>
        <div className={s.brandRow}>
          <Link href={SITE} className={s.brand} aria-label="aumo.finance">
            <AumoWordmark markClass="size-[1.05em]" />
          </Link>
          <span className={s.net}>
            <i className={s.netDot} aria-hidden />
            X Layer
          </span>
        </div>
        <Nav hrefFor={hrefFor} isActive={isActive} />
        <div className={s.spacer} />
        <AgentCard href={hrefFor("/activity")} status={status} down={down} />
        <div className={s.foot}>
          <div className={s.footLinks}>
            <a href={`${SITE}/docs`}>Docs</a>
            <a href={SITE}>aumo.finance</a>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      <div className={s.main}>
        <header className={s.top}>
          <Link href={hrefFor("")} className={s.mobileBrand} aria-label="Overview">
            <AumoWordmark markClass="size-[1.05em]" />
          </Link>
          <div className={s.crumbs}>
            <span>{current?.section ?? "Treasury"}</span>
            <span className={s.crumbSep}>/</span>
            <b>{current?.label ?? "Overview"}</b>
          </div>
          <div className={s.topActions}>
            <Link href={`${hrefFor("")}#ask`} className={`${s.ask} chamfer`}>
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path d="M10 2.5 11.6 8.4 17.5 10l-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6L10 2.5Z" />
              </svg>
              <span>Ask Aumo</span>
            </Link>
            <ConnectButton />
            <MenuButton open={sheet} onClick={() => setSheet((o) => !o)} className={s.menuBtn} />
          </div>
        </header>

        {sheet ? (
          <div className={s.sheet}>
            <Nav hrefFor={hrefFor} isActive={isActive} onNavigate={() => setSheet(false)} />
            <div className="mt-4">
              <AgentCard href={hrefFor("/activity")} status={status} down={down} />
            </div>
            <div className={s.foot}>
              <div className={s.footLinks}>
                <a href={`${SITE}/docs`}>Docs</a>
                <a href={SITE}>aumo.finance</a>
              </div>
              <ThemeToggle />
            </div>
          </div>
        ) : null}

        <main className={s.content}>{children}</main>

        <footer className={s.bottom}>
          <span>© 2026 Aumo · Built on X Layer</span>
          <span className={s.bottomLinks}>
            <a href={`${SITE}/privacy`}>Privacy</a>
            <a href={`${SITE}/terms`}>Terms</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
