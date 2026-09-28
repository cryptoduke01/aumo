import type { Metadata } from "next";
import Image from "next/image";
import { ArrowUpRight, SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { STOCKS, liveStocks } from "@/lib/chain";
import { PageHero } from "@/components/site/page-hero";
import site from "@/components/site/site.module.css";
import s from "./stocks.module.css";

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

const liveSymbols = new Set(liveStocks.map((x) => x.symbol));

const HOW: [string, string][] = [
  [
    "One pool per stock",
    "Each stock lives in its own isolated pool, priced by its own feed. Your position is never entangled with the other stocks or with the safe treasury.",
  ],
  [
    "Priced on-chain, hours enforced",
    "A live market feed sets the price on-chain, and US market hours are enforced by the contract. Trades settle when the market is open.",
  ],
  [
    "Deposit, the agent handles it",
    "Deposit USDT0 and the same autonomous agent that runs the treasury buys and holds the exposure inside fixed on-chain guardrails. Your position settles at the market price when you exit.",
  ],
];

export default function StocksLanding() {
  return (
    <div className={`${site.site} flex flex-1 flex-col`}>
      <SiteHeader />
      <main>
        <PageHero
          eyebrow="Now live on X Layer"
          title="Stocks are live on Aumo."
          lead="Onchain exposure to NVIDIA, Apple, Microsoft and Meta, each in its own pool, priced by a live market feed with US market hours enforced on-chain."
          image="/visuals/pool-stocks.jpg"
        />

        <section className={s.band}>
          <div className={s.bandHead}>
            <a href={APP_STOCKS} className={site.pill}>
              Open Aumo Stocks
              <ArrowUpRight className={site.pillArrow} />
            </a>
            <span className={site.meta}>Four live today. More list as liquidity arrives.</span>
          </div>
          <ul className={s.tickers}>
            {STOCKS.map((st) => {
              const ticker = st.symbol.replace(/x$/, "");
              const live = liveSymbols.has(st.symbol);
              return (
                <li key={st.symbol} className={live ? "" : s.soon}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/brand/stocks/${ticker}.png`} alt="" width={28} height={28} className={s.tickerLogo} />
                  <span className={s.ticker}>{ticker}</span>
                  <span className={site.meta}>{live ? st.name : "Soon"}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={`${s.how} ${site.onPaper}`}>
          <p className={site.eyebrow}>How stock pools work</p>
          <h2 className={s.howTitle}>Same guardrail model as the rest of Aumo. Isolated, priced on-chain, and provable.</h2>
          <div className={s.howGrid}>
            {HOW.map(([title, body]) => (
              <div key={title} className={s.howItem}>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
          <p className={s.risk}>
            These pools hold directional stock exposure. They are not capital preservation and can lose value. The app
            shows the full risk detail before any deposit.
          </p>
        </section>

        <section className={s.closing}>
          <div className={s.banner}>
            <span className={s.onlyDark}>
              <Image src="/visuals/horizon.jpg" alt="" fill sizes="(max-width: 1280px) 100vw, 80rem" className={s.bannerImg} />
            </span>
            <span className={s.onlyLight}>
              <Image src="/visuals/horizon-light.jpg" alt="" fill sizes="(max-width: 1280px) 100vw, 80rem" className={s.bannerImg} />
            </span>
            <div className={s.bannerContent}>
              <h2 className={s.bannerTitle}>Real world assets, run by an agent.</h2>
              <a href={APP_STOCKS} className={site.pill}>
                Open Aumo Stocks
                <ArrowUpRight className={site.pillArrow} />
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
