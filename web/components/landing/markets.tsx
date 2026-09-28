"use client";

import Image from "next/image";
import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, type RefObject } from "react";
import site from "../site/site.module.css";
import s from "./landing.module.css";
import { phase, ScrollWords, useLeadMove, useMode, type Mode } from "./scroll";

const APP = "https://app.aumo.finance";

const MARKETS = [
  {
    href: `${APP}/vault`,
    img: "/visuals/pool-stable.jpg",
    text: "Stablecoin yield. USDT0 routed across Aave, a Treasury-backed dollar, Pendle and Uniswap fees.",
  },
  {
    href: `${APP}/stocks`,
    img: "/visuals/pool-stocks.jpg",
    text: "Tokenized stocks. NVIDIA, Apple, Microsoft and Meta, bought and held while the market is open.",
  },
  {
    href: `${APP}/basket`,
    img: "/visuals/pool-basket.jpg",
    text: "Diversified basket. All four at equal weight, rebalanced when they drift apart.",
  },
  {
    href: `${APP}/gold`,
    img: "/visuals/pool-gold.jpg",
    text: "Tokenized gold. Tracks gold, and its gold entitlement grows over time.",
  },
];

// Choreography, as fractions of the pinned scroll:
//   0.00-0.26  the lead lights up on the left while the four markets wait on the right as an ordered
//              2x2 grid of square thumbnails (stablecoin, stocks / basket, gold)
//   0.28-0.50  the lead glides into the header; the top row opens into two big cards, the bottom
//              row slides away below the frame
//   0.60-0.84  the bottom row returns from below and laps over the first pair, which sink and dim
const WORDS: [number, number] = [0, 0.26];
const LEAD: [number, number] = [0.28, 0.46];
const DEAL: [number, number] = [0.3, 0.5];
const LAP = (j: number): [number, number] => [0.6 + j * 0.04, 0.8 + j * 0.04];
const CAPTION = (i: number): [number, number] => (i < 2 ? [0.46 + i * 0.03, 0.62 + i * 0.03] : [0.74 + (i - 2) * 0.03, 0.9 + (i - 2) * 0.03]);

const ease = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Geo = { cx: MotionValue<number>; cy: MotionValue<number>; w: MotionValue<number>; h: MotionValue<number> };

// Where each slot sits inside the pinned frame, measured from layout (transform-independent).
function useSlotGeometry(frame: RefObject<HTMLElement | null>, slot: RefObject<HTMLElement | null>): Geo {
  const cx = useMotionValue(0);
  const cy = useMotionValue(0);
  const w = useMotionValue(1);
  const h = useMotionValue(1);
  useEffect(() => {
    const measure = () => {
      const f = frame.current;
      const el = slot.current;
      if (!f || !el) return;
      let top = 0;
      let left = 0;
      let node: HTMLElement | null = el;
      while (node && node !== f) {
        top += node.offsetTop;
        left += node.offsetLeft;
        node = node.offsetParent as HTMLElement | null;
      }
      cx.set(left + el.offsetWidth / 2);
      cy.set(top + el.offsetHeight / 2);
      w.set(el.offsetWidth);
      h.set(el.offsetHeight);
    };
    const raf = requestAnimationFrame(measure);
    document.fonts?.ready.then(measure).catch(() => {});
    const ro = new ResizeObserver(measure);
    if (frame.current) ro.observe(frame.current);
    if (slot.current) ro.observe(slot.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [frame, slot, cx, cy, w, h]);
  return { cx, cy, w, h };
}

function Card({
  i,
  progress,
  geo,
  frameW,
  frameH,
  mode,
}: {
  i: number;
  progress: MotionValue<number>;
  geo: Geo;
  frameW: MotionValue<number>;
  frameH: MotionValue<number>;
  mode: Mode;
}) {
  const m = MARKETS[i];
  const first = i < 2; // lands in the deal; the other two lap over it later
  const poster = useRef<HTMLSpanElement>(null);
  const posterH = useMotionValue(1);
  useEffect(() => {
    const el = poster.current;
    if (!el) return;
    const measure = () => posterH.set(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [posterH]);
  const inputs = [progress, geo.cx, geo.cy, geo.w, geo.h, frameW, frameH, posterH];

  // Everything is expressed as a pose of the full-size card: translate, scale, and a clip that
  // crops it to a square thumbnail while it sits in the grid.
  const pose = (p: number, cx: number, cy: number, w: number, h: number, fw: number, fh: number, ph: number) => {
    const wide = fw >= 1100;
    const T = wide ? Math.min(fw * 0.155, fh * 0.27) : Math.min(fw * 0.19, fh * 0.2); // thumbnail side
    const gap = 10 + 8 * ease(phase(p, WORDS[0], WORDS[1])); // the grid breathes open as the words land
    const gx = fw * (wide ? 0.76 : 0.7);
    const gy = fh * (wide ? 0.55 : 0.78);
    const col = i % 2;
    const row = Math.floor(i / 2);
    const S = Math.max(1, Math.min(w, ph)); // square crop of the card's image, from the top
    const k = T / S;
    const sqCy = cy - h / 2 + S / 2; // centre of that square, unscaled, in frame coordinates
    const grid = {
      x: gx + (col - 0.5) * (T + gap) - cx,
      y: gy + (row - 0.5) * (T + gap) - sqCy,
      scale: k,
      clip: 1,
    };
    const home = { x: 0, y: 0, scale: 1, clip: 0 };
    const below = { x: 0, y: fh + 48 - (cy - h / 2), scale: 1, clip: 0 };
    const deal = ease(phase(p, DEAL[0], DEAL[1]));
    const mix = (a: typeof home, b: typeof home, t: number) => ({
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      scale: lerp(a.scale, b.scale, t),
      clip: lerp(a.clip, b.clip, t),
    });
    const crop = (c: number, scale: number) => {
      const side = ((w - S) / 2) * c;
      const bottom = (h - S) * c;
      const r = (12 / Math.max(scale, 0.05)) * c;
      return `inset(0px ${side}px ${bottom}px ${side}px round ${r}px)`;
    };
    if (first) {
      const under = ease(phase(p, ...LAP(i)));
      const q = mix(grid, home, deal);
      return {
        x: q.x,
        y: q.y,
        scale: q.scale * (1 - 0.07 * under),
        clip: crop(q.clip, q.scale),
        origin: `50% ${S / 2}px`,
        dim: 1 - 0.45 * under,
      };
    }
    const lap = ease(phase(p, ...LAP(i - 2)));
    const q = mix(mix(grid, below, deal), home, lap);
    return { x: q.x, y: q.y, scale: q.scale, clip: crop(q.clip, q.scale), origin: `50% ${S / 2}px`, dim: 1 };
  };

  const get = (v: number[]) => pose(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
  const x = useTransform(inputs, (v: number[]) => get(v).x);
  const y = useTransform(inputs, (v: number[]) => get(v).y);
  const scale = useTransform(inputs, (v: number[]) => get(v).scale);
  const clipPath = useTransform(inputs, (v: number[]) => get(v).clip);
  const transformOrigin = useTransform(inputs, (v: number[]) => get(v).origin);
  const shade = useTransform(inputs, (v: number[]) => 1 - get(v).dim);

  return (
    <motion.a
      href={m.href}
      className={s.bigCard}
      style={{ x, y, scale, clipPath, transformOrigin, zIndex: i + 1 }}
    >
      <span ref={poster} className={s.bigPoster}>
        <Image src={m.img} alt="" fill loading="eager" sizes="50vw" className={s.posterImg} />
        {first ? <motion.span className={s.dim} style={{ opacity: shade }} aria-hidden /> : null}
      </span>
      <ScrollWords key={mode} className={s.bigCaption} progress={progress} range={CAPTION(i)} from={0} mode={mode} text={m.text} />
    </motion.a>
  );
}

export function Markets() {
  const stage = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLDivElement>(null);
  const eyebrow = useRef<HTMLParagraphElement>(null);
  const slotA = useRef<HTMLDivElement>(null);
  const slotB = useRef<HTMLDivElement>(null);
  const mode = useMode(640);
  const pinned = mode === "pinned";
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start start", "end end"] });
  const { x, y } = useLeadMove(sticky, lead, eyebrow, scrollYProgress, LEAD);
  const geoA = useSlotGeometry(sticky, slotA);
  const geoB = useSlotGeometry(sticky, slotB);
  const frameW = useMotionValue(1440);
  const frameH = useMotionValue(900);
  useEffect(() => {
    const el = sticky.current;
    if (!el) return;
    const measure = () => {
      frameW.set(el.clientWidth);
      frameH.set(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameW, frameH]);

  return (
    <section
      ref={stage}
      id="markets"
      className={`${s.stage} ${s.marketsStage} ${s.paper} ${site.onPaper} ${pinned ? "" : s.static}`}
    >
      <div ref={sticky} className={`${s.stageSticky} ${s.marketsSticky}`}>
        <div className={s.pinHeader}>
          <p ref={eyebrow} className={site.eyebrow}>
            What it runs
          </p>
          <motion.div ref={lead} className={s.pinLead} style={pinned ? { x, y } : { x: 0, y: 0 }}>
            <ScrollWords
              key={mode}
              progress={scrollYProgress}
              range={WORDS}
              from={0.12}
              mode={mode}
              text="One agent, four ways to put money to work. Stablecoin yield by default, with opt-in pools for tokenized US stocks, an equal-weight basket, and yield-bearing gold."
            />
          </motion.div>
        </div>

        {pinned ? (
          <div className={s.duo}>
            <div ref={slotA} className={s.slot}>
              <Card i={0} progress={scrollYProgress} geo={geoA} frameW={frameW} frameH={frameH} mode={mode} />
              <Card i={2} progress={scrollYProgress} geo={geoA} frameW={frameW} frameH={frameH} mode={mode} />
            </div>
            <div ref={slotB} className={s.slot}>
              <Card i={1} progress={scrollYProgress} geo={geoB} frameW={frameW} frameH={frameH} mode={mode} />
              <Card i={3} progress={scrollYProgress} geo={geoB} frameW={frameW} frameH={frameH} mode={mode} />
            </div>
          </div>
        ) : (
          <div className={s.duoStatic}>
            {MARKETS.map((m) => (
              <a key={m.href} href={m.href} className={s.card}>
                <span className={s.poster}>
                  <Image src={m.img} alt="" fill sizes="(max-width: 640px) 100vw, 50vw" className={s.posterImg} />
                </span>
                <ScrollWords key={mode} className={s.cardText} mode={mode} from={0.12} text={m.text} />
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
