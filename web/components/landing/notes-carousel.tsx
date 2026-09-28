"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import site from "../site/site.module.css";
import s from "./landing.module.css";

const NOTES = [
  {
    href: "/research",
    img: "/visuals/note-research.jpg",
    title: "Leaving before the break: a 30-cycle stress test against a yield-chasing strategy",
    meta: "Research note",
  },
  {
    href: "/research",
    img: "/visuals/note-basket.jpg",
    title: "Why a basket: timing single stocks whipsawed, spreading across four is what cut the drawdown",
    meta: "Backtest",
  },
  {
    href: "/internals",
    img: "/visuals/note-security.jpg",
    title: "Inside the self-audit: two Medium findings, proven on a fork and fixed before the pools opened",
    meta: "Security",
  },
  {
    href: "/docs",
    img: "/visuals/note-gold.jpg",
    title: "Gold that grows its own entitlement: how Aumo prices and holds PAXGy",
    meta: "Docs",
  },
  {
    href: "/docs",
    img: "/visuals/note-cycle.jpg",
    title: "Sense, score, reason, act, prove: one cycle of the agent from start to receipt",
    meta: "Docs",
  },
  {
    href: "/whitepaper",
    img: "/visuals/note-whitepaper.jpg",
    title: "A guardrailed treasury agent: the Aumo whitepaper",
    meta: "Whitepaper, version 0.6",
  },
];

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={dir === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Research as a horizontal carousel: snap-scrolls by card, arrows step one card at a time, and a
// mouse can drag it like a strip of film. Touch and trackpads use native scrolling.
export function NotesCarousel() {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  }, []);

  useEffect(() => {
    update();
    const el = track.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    const card = el?.querySelector("a");
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap || "0");
    el.scrollBy({ left: dir * (card.getBoundingClientRect().width + gap), behavior: "smooth" });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !track.current) return;
    drag.current = { x: e.clientX, left: track.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = track.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      el.setAttribute("data-dragging", "");
      el.setPointerCapture(e.pointerId);
    }
    if (d.moved) el.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    const el = track.current;
    const d = drag.current;
    drag.current = null;
    if (!el || !d?.moved) return;
    el.removeAttribute("data-dragging");
    // settle onto the nearest card
    const card = el.querySelector("a");
    if (!card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap || "0");
    const w = card.getBoundingClientRect().width + gap;
    el.scrollTo({ left: Math.round(el.scrollLeft / w) * w, behavior: "smooth" });
  };

  return (
    <section className={`${s.notes} ${site.onPaper}`} aria-roledescription="carousel" aria-label="Research">
      <div className={s.notesHead}>
        <p className={site.eyebrow}>Research</p>
        <div className={s.notesControls}>
          <Link href="/research" className={site.textLink}>
            View all
          </Link>
          <button type="button" className={s.arrowBtn} onClick={() => step(-1)} disabled={edge.start} aria-label="Previous">
            <Chevron dir="left" />
          </button>
          <button type="button" className={s.arrowBtn} onClick={() => step(1)} disabled={edge.end} aria-label="Next">
            <Chevron dir="right" />
          </button>
        </div>
      </div>
      <div
        ref={track}
        className={s.track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        {NOTES.map((n) => (
          <Link key={n.title} href={n.href} className={s.note} draggable={false}>
            <span className={s.cover}>
              <Image src={n.img} alt="" fill sizes="(max-width: 560px) 84vw, (max-width: 900px) 72vw, 33vw" className={s.coverImg} draggable={false} />
            </span>
            <span className={s.noteName}>{n.title}</span>
            <span className={`${s.noteMeta} ${site.meta}`}>{n.meta}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
