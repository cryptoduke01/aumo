"use client";

import { motion, useMotionValue, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import s from "./landing.module.css";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
// ease-in-out cubic: the handoffs between phases should neither snap nor drift
const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
export const phase = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

// How a section moves:
//   "pinned" - the stage sticks and everything is driven by the section's own scroll (wide enough);
//   "flow"   - too narrow to pin, so each piece reveals as it scrolls through the viewport;
//   "still"  - the reader asked for reduced motion: everything is simply there.
// Defaults to pinned so desktop never reflows after hydration (these sections sit below the fold).
export type Mode = "pinned" | "flow" | "still";
export function useMode(minWidth: number): Mode {
  const [mode, setMode] = useState<Mode>("pinned");
  useEffect(() => {
    const wide = window.matchMedia(`(min-width: ${minWidth}px)`);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMode(calm.matches ? "still" : wide.matches ? "pinned" : "flow");
    update();
    wide.addEventListener("change", update);
    calm.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      calm.removeEventListener("change", update);
    };
  }, [minWidth]);
  return mode;
}

function Word({
  children,
  progress,
  range,
  from,
  still,
}: {
  children: string;
  progress: MotionValue<number>;
  range: [number, number];
  from: number;
  still: boolean;
}) {
  const opacity = useTransform(progress, range, [from, 1]);
  return (
    <motion.span className={s.word} style={{ opacity: still ? 1 : opacity }}>
      {children}{" "}
    </motion.span>
  );
}

// Words that light up one after another. Pinned: driven by the stage's progress across `range`.
// Flow: driven by this element's own pass through the viewport. Still: fully lit.
export function ScrollWords({
  text,
  progress,
  range = [0, 1],
  from = 0.14,
  mode,
  className,
}: {
  text: string;
  progress?: MotionValue<number>;
  range?: [number, number];
  from?: number;
  mode: Mode;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress: local } = useScroll({ target: ref, offset: ["start 0.92", "end 0.55"] });
  const pinnedDrive = mode === "pinned" && progress;
  const driver = pinnedDrive ? progress : local;
  const [a, b] = pinnedDrive ? range : [0, 1];
  const words = text.split(" ");
  const step = (b - a) / words.length;
  return (
    <p ref={ref} className={className} aria-label={text}>
      <span aria-hidden key={pinnedDrive ? "pinned" : "local"}>
        {words.map((w, i) => {
          const start = a + i * step;
          return (
            <Word key={i} progress={driver} range={[start, Math.min(b, start + step * 2.2)]} from={from} still={mode === "still"}>
              {w}
            </Word>
          );
        })}
      </span>
    </p>
  );
}

// The lead paragraph starts vertically centred on the left edge (where the eyebrow sits), then
// slides into its resting place in the header row. Offsets are measured from layout (offsetLeft /
// offsetTop are transform-independent), so the move lands exactly wherever the lead reflows to.
export function useLeadMove(
  stage: RefObject<HTMLElement | null>,
  lead: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null>,
  progress: MotionValue<number>,
  range: [number, number],
) {
  const dx = useMotionValue(0);
  const dy = useMotionValue(0);
  // Combined (array-form) transforms subscribe to both inputs, so a later re-measure of the
  // offsets moves the lead even while the reader is not scrolling.
  const x = useTransform([progress, dx], ([p, d]: number[]) => (1 - easeInOut(phase(p, range[0], range[1]))) * d);
  const y = useTransform([progress, dy], ([p, d]: number[]) => (1 - easeInOut(phase(p, range[0], range[1]))) * d);

  useEffect(() => {
    const measure = () => {
      const st = stage.current;
      const el = lead.current;
      const an = anchor.current;
      if (!st || !el || !an) return;
      const { top: leadTop, left: leadLeft } = offsetWithin(el, st);
      const anchorLeft = offsetWithin(an, st).left;
      dx.set(anchorLeft - leadLeft);
      dy.set(st.clientHeight / 2 - el.offsetHeight / 2 - leadTop);
    };
    // measure after the subscriptions above are live, and again once the webfont has settled
    const raf = requestAnimationFrame(measure);
    document.fonts?.ready.then(measure).catch(() => {});
    const ro = new ResizeObserver(measure);
    if (stage.current) ro.observe(stage.current);
    if (lead.current) ro.observe(lead.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [stage, lead, anchor, dx, dy]);

  return { x, y };
}

function offsetWithin(el: HTMLElement, ancestor: HTMLElement) {
  let top = 0;
  let left = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    top += node.offsetTop;
    left += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
  }
  return { top, left };
}

// A block that fades and rises into place: across `range` of the stage when pinned, or as it
// enters the viewport in flow mode.
export function Rise({
  children,
  progress,
  range,
  mode,
  className,
  distance = 48,
}: {
  children: ReactNode;
  progress: MotionValue<number>;
  range: [number, number];
  mode: Mode;
  className?: string;
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: local } = useScroll({ target: ref, offset: ["start 1", "start 0.72"] });
  // callers key <Rise> on `mode`, so this closure is always the current mode's
  const t = useTransform([progress, local], ([p, l]: number[]) =>
    mode === "pinned" ? easeInOut(phase(p, range[0], range[1])) : easeInOut(l),
  );
  const opacity = useTransform(t, (v) => v);
  const y = useTransform(t, (v) => (1 - v) * distance);
  return (
    <motion.div ref={ref} className={className} style={mode === "still" ? { opacity: 1, y: 0 } : { opacity, y }}>
      {children}
    </motion.div>
  );
}
