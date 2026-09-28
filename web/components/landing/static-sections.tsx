import Image from "next/image";
import type { CSSProperties } from "react";
import { ArrowUpRight } from "../site-header";
import site from "../site/site.module.css";
import s from "./landing.module.css";
import { NotesCarousel } from "./notes-carousel";

const APP = "https://app.aumo.finance";

// ── Hero ──────────────────────────────────────────────────────────────
// The vault, lit by one seam of Sovereign light: a low-key photograph in dark mode, a high-key one in light.
export function Hero() {
  return (
    <section className={s.hero}>
      <div className={s.heroImage} aria-hidden>
        <span className={s.onlyDark}>
          <Image src="/visuals/hero.jpg" alt="" fill priority sizes="100vw" />
        </span>
        <span className={s.onlyLight}>
          <Image src="/visuals/hero-light.jpg" alt="" fill sizes="100vw" />
        </span>
      </div>
      <div className={s.heroShade} aria-hidden />
      <div />
      <div className={s.heroFoot}>
        <div className={s.heroContent}>
          <h1 className={s.heroTitle}>The autonomous treasury for stablecoins.</h1>
          <p className={s.heroSub}>
            An AI agent that puts idle USDT0 to work in the best risk-adjusted yield on X Layer, inside limits
            written into the contract.
          </p>
          <div className={s.heroActions}>
            <a href={APP} className={site.pill}>
              Launch app
              <ArrowUpRight className={site.pillArrow} />
            </a>
            <a href="#control" className={site.textLink}>
              How it stays safe
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Runs on ───────────────────────────────────────────────────────────
// Official marks, rendered through a mask so every logo takes the same ink and follows the theme.
function Logo({ src, w, h, label }: { src: string; w: number; h: number; label?: string }) {
  const style = {
    width: `${w}rem`,
    height: `${h}rem`,
    maskImage: `url(${src})`,
    WebkitMaskImage: `url(${src})`,
  } as CSSProperties;
  return <span className={s.logo} style={style} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

const RAIL: { name: string; src: string; w: number; h: number; lockup?: boolean }[] = [
  { name: "Aave", src: "/brand/partners/aave.svg", w: 6.4, h: 1.09 },
  { name: "Pendle", src: "/brand/partners/pendle.svg", w: 1.6, h: 1.6, lockup: true },
  { name: "Uniswap", src: "/brand/partners/uniswap.svg", w: 1.8, h: 1.8, lockup: true },
  { name: "LayerZero", src: "/brand/partners/layerzero.svg", w: 1, h: 1.7, lockup: true },
  { name: "Paxos", src: "/brand/partners/paxos.svg", w: 5.8, h: 1.75 },
  { name: "xStocks", src: "/brand/partners/xstocks.svg", w: 6.3, h: 1.5 },
];

export function RunsOn() {
  return (
    <section className={`${s.runs} ${site.onPaper}`}>
      <div className={s.runsHead}>
        <p className={site.eyebrow}>Runs on</p>
        <a href="https://web3.okx.com/xlayer" target="_blank" rel="noreferrer" className={s.xlayer} aria-label="X Layer">
          <Logo src="/brand/xlayer-wordmark.png" w={5.7} h={1.45} />
        </a>
      </div>
      <div className={s.railViewport}>
        <ul className={s.rail}>
          {RAIL.map((p) => (
            <li key={p.name}>
              {p.lockup ? (
                <span className={s.lockup}>
                  <Logo src={p.src} w={p.w} h={p.h} />
                  {p.name}
                </span>
              ) : (
                <span className={s.lockup}>
                  <Logo src={p.src} w={p.w} h={p.h} label={p.name} />
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Research (carousel) ───────────────────────────────────────────────
export function Notes() {
  return <NotesCarousel />;
}

// ── Closing ───────────────────────────────────────────────────────────
export function Closing() {
  return (
    <section className={s.closing}>
      <div className={s.banner}>
        <span className={s.onlyDark}>
          <Image src="/visuals/horizon.jpg" alt="" fill sizes="(max-width: 1280px) 100vw, 80rem" className={s.bannerImg} />
        </span>
        <span className={s.onlyLight}>
          <Image src="/visuals/horizon-light.jpg" alt="" fill sizes="(max-width: 1280px) 100vw, 80rem" className={s.bannerImg} />
        </span>
        <div className={s.bannerContent}>
          <h2 className={s.bannerTitle}>Put your stablecoins to work.</h2>
          <a href={APP} className={site.pill}>
            Launch app
            <ArrowUpRight className={site.pillArrow} />
          </a>
        </div>
      </div>
    </section>
  );
}
