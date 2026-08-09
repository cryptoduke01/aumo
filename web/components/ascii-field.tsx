"use client";

import { useEffect, useRef } from "react";

// A sparse field of monospace glyphs drifting slowly upward behind the hero.
// Monochrome (reads the theme's ink/paper colour), low-contrast, scoped to its
// section, and cheap: it stops painting the moment it scrolls out of view or the
// tab is hidden, so it never taxes the page. Reduced-motion renders one still
// frame. Purely decorative - the hero never depends on it.
const GLYPHS = "0123456789%+-·↑↓abcdef/".split("");

export function AsciiField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const CELL = 17;
    let cells: { x: number; y: number; ch: string; a: number }[] = [];
    let w = 0,
      h = 0,
      raf = 0,
      last = 0,
      glyph = "243,241,234",
      onScreen = true;
    const rand = (n: number) => Math.floor(Math.random() * n);

    const readColour = () => {
      const v = getComputedStyle(document.body).getPropertyValue("--glyph-rgb");
      if (v.trim()) glyph = v.trim();
    };

    const seed = () => {
      cells = [];
      const cols = Math.ceil(w / CELL);
      const rows = Math.ceil(h / CELL) + 2;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (Math.random() > 0.2) continue; // ~20% density
          const b = Math.random();
          cells.push({
            x: c * CELL + CELL * 0.15,
            y: r * CELL,
            ch: GLYPHS[rand(GLYPHS.length)],
            a: b > 0.9 ? 0.42 : b > 0.7 ? 0.24 : 0.12,
          });
        }
      }
    };

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mono =
        getComputedStyle(document.body).getPropertyValue("--font-mono") ||
        "monospace";
      ctx.font = `${CELL - 4}px ${mono}`;
      ctx.textBaseline = "top";
      readColour();
      seed();
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of cells) {
        ctx.fillStyle = `rgba(${glyph},${p.a})`;
        ctx.fillText(p.ch, p.x, p.y);
      }
    };

    const tick = (t: number) => {
      const dt = Math.min(64, t - last || 16);
      last = t;
      const dy = (dt / 1000) * 9; // ~9px/s upward drift
      for (const p of cells) {
        p.y -= dy;
        if (p.y < -CELL) {
          p.y += h + CELL * 2;
          if (Math.random() > 0.6) p.ch = GLYPHS[rand(GLYPHS.length)];
        }
      }
      draw();
      raf = requestAnimationFrame(tick);
    };

    const running = () => raf !== 0;
    const start = () => {
      if (reduce || running() || !onScreen || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();
    start();

    const onVis = () => (document.hidden ? stop() : start());
    const onTheme = () => {
      readColour();
      draw();
    };
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting;
        onScreen ? start() : stop();
      },
      { threshold: 0 },
    );
    io.observe(parent);
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("themechange", onTheme);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("themechange", onTheme);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
