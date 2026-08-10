"use client";

import { useEffect, useRef } from "react";
import { Orb } from "./orb";

// A dithered area chart drawn on a tiny <canvas> — no dependency. The area under the curve is
// filled with an ordered (Bayer 8x8) dither in the brand accent, denser near the line and thinning
// toward the baseline, for the retro dithered-chart look. The line rides on top. Themeable: reads
// --accent / --border from the element's computed style, and repaints on theme change.
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

export function DitherArea({
  values,
  className = "",
  height = 120,
}: {
  values: number[];
  className?: string;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const rect = parent.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cs = getComputedStyle(canvas);
      const accent = cs.getPropertyValue("--accent").trim() || "#ffbc3e";
      const border = cs.getPropertyValue("--border").trim() || "#232323";

      if (!values || values.length < 2) return;
      const pad = 8;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      const xAt = (i: number) => (i / (values.length - 1)) * w;
      const yAt = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);

      // gridlines
      ctx.strokeStyle = border;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 0.5;
      for (const g of [0.33, 0.66]) {
        const gy = Math.round(pad + g * (h - pad * 2)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // curve height at each x (linear interp between samples)
      const curveY = (x: number) => {
        const t = (x / w) * (values.length - 1);
        const i = Math.min(values.length - 2, Math.floor(t));
        const f = t - i;
        return yAt(values[i]) * (1 - f) + yAt(values[i + 1]) * f;
      };

      // ordered-dither fill under the curve
      ctx.fillStyle = accent;
      for (let x = 0; x < w; x++) {
        const top = curveY(x);
        for (let y = Math.floor(top); y < h - 1; y++) {
          // density: ~0.9 just under the line, fading to ~0.12 at the baseline
          const depth = (y - top) / Math.max(1, h - pad - top);
          const density = 0.9 - depth * 0.78;
          const threshold = (BAYER8[y & 7][x & 7] + 0.5) / 64;
          if (density > threshold) ctx.fillRect(x, y, 1, 1);
        }
      }

      // line on top
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < values.length; i++) {
        const px = xAt(i);
        const py = yAt(values[i]);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();

      // endpoint dot
      ctx.beginPath();
      ctx.arc(xAt(values.length - 1), yAt(values[values.length - 1]), 2.4, 0, Math.PI * 2);
      ctx.fill();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    const onTheme = () => draw();
    window.addEventListener("themechange", onTheme);
    return () => {
      ro.disconnect();
      window.removeEventListener("themechange", onTheme);
    };
  }, [values, height]);

  if (!values || values.length < 2) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2.5 ${className}`}
        style={{ height }}
      >
        <Orb className="size-5 text-accent" />
        <span className="text-[11px] text-faint">Collecting cycle data…</span>
      </div>
    );
  }

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`block w-full ${className}`}
      style={{ height }}
    />
  );
}
