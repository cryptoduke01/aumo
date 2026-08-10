"use client";

import { useEffect, useRef } from "react";

// A living, generative dither field — the SentraCore circuit reimagined in Sovereign gold on Ink.
// Concentric pulses breathe out from a centre (the vault), a slow horizontal drift runs a current
// across them, and the whole field is quantised with an ordered (Bayer 8x8) dither so it reads as
// signal, not gradient. Pure canvas, no dependency. Pauses when off-screen or the tab is hidden,
// and renders a single static frame under prefers-reduced-motion.
const BAYER8 = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

export function DitherField({
  className = "",
  cell = 3,
  coreY = 0.46,
  intensity = 1,
}: {
  className?: string;
  cell?: number;
  // vertical position of the dense core (0 = top, 1 = bottom). Push it low to keep a headline clear.
  coreY?: number;
  // overall alpha multiplier — dial the whole field down when it sits behind text.
  intensity?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = false;
    let cols = 0;
    let rows = 0;
    let accent = "#ffbc3e";

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#ffbc3e";
    };

    // one frame: intensity = breathing radial pulses from centre + horizontal current, dithered.
    const frame = (t: number) => {
      const w = cols * cell;
      const h = rows * cell;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = accent;
      const cx = cols * 0.5;
      const cy = rows * coreY;
      const time = t * 0.0006;
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const dx = (gx - cx) / cols;
          const dy = (gy - cy) / rows;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // outward-breathing rings + a drifting horizontal current
          const rings = Math.sin(dist * 26 - time * 4);
          const current = Math.sin((gx / cols) * 7 + time * 2 + dy * 3);
          // core glow that falls off with distance, so the centre stays dense
          const core = Math.max(0, 1 - dist * 2.1);
          let v = 0.5 + 0.28 * rings + 0.14 * current;
          v = v * (0.35 + 0.65 * core) + core * 0.28;
          const threshold = (BAYER8[gy & 7][gx & 7] + 0.5) / 64;
          if (v > threshold) {
            // fade opacity toward the edges so the field dissolves into the page
            const a = Math.min(1, 0.35 + core * 0.9) * intensity;
            ctx.globalAlpha = a;
            ctx.fillRect(gx * cell, gy * cell, cell - 0.6, cell - 0.6);
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      if (!running) return;
      frame(t);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || reduce) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    frame(0); // paint an initial frame immediately (and the only frame if reduced-motion)

    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0.05 },
    );
    io.observe(parent);
    const ro = new ResizeObserver(() => {
      resize();
      if (!running) frame(0);
    });
    ro.observe(parent);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    const onTheme = () => {
      accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#ffbc3e";
      if (!running) frame(0);
    };
    window.addEventListener("themechange", onTheme);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("themechange", onTheme);
    };
  }, [cell, coreY, intensity]);

  return <canvas ref={ref} aria-hidden className={`block h-full w-full ${className}`} />;
}
