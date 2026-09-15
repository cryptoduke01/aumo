import type { Metadata } from "next";
import { DitherField } from "@/components/dither-field";
import { DitherBg } from "@/components/dither-bg";
import { Grain } from "@/components/grain";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { STOCKS, liveStocks } from "@/lib/chain";

// The launch URL shared in the video and posts is aumo.finance/stocks. The app itself lives at
// /app/stocks (served clean at app.aumo.finance/stocks). This marketing page makes the shared URL a
// real, on-brand landing with a clear way into the app, instead of a 404. On the app subdomain the
// /* -> /app/* rewrite shadows this route, so the live app is untouched.
export const metadata: Metadata = {
  title: "Stocks on Aumo · tokenized equities on X Layer",
  description:
    "Tokenized stocks are live on Aumo. Get onchain exposure to NVIDIA, Apple, Microsoft and Meta on X Layer, each in its own pool, priced by a live market feed with market hours enforced onchain.",
  alternates: { canonical: "https://aumo.finance/stocks" },
  openGraph: {
    title: "Stocks are live on Aumo",
    description:
      "Onchain exposure to NVIDIA, Apple, Microsoft and Meta on X Layer, run by Aumo's autonomous agent.",
    url: "https://aumo.finance/stocks",
    siteName: "Aumo",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stocks are live on Aumo",
    description:
      "Onchain exposure to NVIDIA, Apple, Microsoft and Meta on X Layer, run by Aumo's autonomous agent.",
  },
};

const APP_STOCKS = "https://app.aumo.finance/stocks";

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

function OpenApp({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <a
      href={APP_STOCKS}
      className={`chamfer group inline-flex items-center gap-2 bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98] ${className}`}
      style={{ ["--cut" as string]: "10px" }}
    >
      {children ?? "Open Aumo Stocks"}
      <ArrowOut className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  );
}

const liveSymbols = new Set(liveStocks.map((s) => s.symbol));

function Chip({ symbol, name, live }: { symbol: string; name: string; live: boolean }) {
  const ticker = symbol.replace(/x$/, "");
  return (
    <div
      className={`flex items-center gap-2.5 rounded-full border px-3.5 py-2 ${
        live ? "border-border bg-surface/60" : "border-border/50 bg-surface/20 opacity-60"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/brand/stocks/${ticker}.png`}
        alt={name}
        width={24}
        height={24}
        className="size-6 rounded-full"
      />
      <span className="text-sm font-medium tracking-tight text-foreground">{ticker}</span>
      {!live && <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">soon</span>}
    </div>
  );
}

const HOW: [string, string][] = [
  [
    "One pool per stock",
    "Each stock lives in its own isolated pool, priced by its own feed. Your position is never entangled with the other stocks or with the safe treasury.",
  ],
  [
    "Priced onchain, hours enforced",
    "A live market feed sets the price on-chain, and US market hours are enforced by the contract. Trades settle when the market is open.",
  ],
  [
    "Deposit, the agent handles it",
    "Deposit USDT0 and the same autonomous agent that runs the treasury buys and holds the exposure inside fixed onchain guardrails. Your position settles at the market price when you exit.",
  ],
];

export default function StocksLanding() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      {/* ── hero ─────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <DitherField
            coreY={0.82}
            intensity={0.6}
            className="[mask-image:linear-gradient(to_bottom,transparent_0%,#000_34%,#000_78%,transparent_100%)]"
          />
          <div
            className="absolute inset-0 mix-blend-soft-light"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 74%, color-mix(in srgb, var(--primary) 40%, transparent), transparent 64%)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(66% 52% at 50% 34%, var(--background) 0%, color-mix(in srgb, var(--background) 82%, transparent) 40%, transparent 72%)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
        </div>
        <Grain />
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-5 pt-32 pb-24 text-center sm:px-8 sm:pt-44 sm:pb-28">
          <span className="text-xs uppercase tracking-[0.14em] text-accent">Now live on X Layer</span>
          <h1 className="mt-4 max-w-3xl text-balance text-[2.9rem] font-medium leading-[1.02] tracking-[-0.02em] sm:text-7xl">
            Stocks are live on Aumo.
          </h1>
          <p className="mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Aumo is an autonomous AI agent for real world assets. Get onchain exposure to NVIDIA,
            Apple, Microsoft and Meta, each in its own pool, priced by a live market feed with US
            market hours enforced onchain.
          </p>
          <OpenApp className="mt-9" />

          {/* live + coming-soon chips */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-2.5">
            {STOCKS.map((s) => (
              <Chip key={s.symbol} symbol={s.symbol} name={s.name} live={liveSymbols.has(s.symbol)} />
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Four live today. More list as liquidity arrives.
          </p>
        </div>
      </section>

      {/* ── how it works ─────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden border-t border-border/70">
        <Grain />
        <div className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-8">
          <h2 className="max-w-xl text-balance text-2xl font-medium tracking-tight sm:text-3xl">
            How stock pools work.
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            Same guardrail model as the rest of Aumo. Isolated, priced onchain, and provable.
          </p>
          <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
            {HOW.map(([title, body], i) => (
              <div key={title} className="flex flex-col">
                <span className="text-sm font-medium text-accent tnum">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-medium text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 max-w-2xl rounded-2xl border border-border bg-surface/40 p-5 text-sm leading-relaxed text-muted-foreground">
            These pools hold directional stock exposure. They are not capital preservation and can
            lose value. The app shows the full risk detail before any deposit.
          </div>
        </div>
      </section>

      {/* ── closing ──────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden border-t border-border/70">
        <DitherBg src="/dither-images/HMxjjf9awAA2faD.jpeg" from="center" opacity={0.28} />
        <Grain />
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 py-28 text-center sm:px-8">
          <h2 className="max-w-xl text-balance text-3xl font-medium tracking-tight sm:text-4xl">
            Real world assets, run by an agent.
          </h2>
          <OpenApp className="mt-8" />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
