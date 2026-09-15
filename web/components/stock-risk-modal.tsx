"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const ACK_KEY = "aumo:stocks-risk-ack";

/**
 * A one-time, dismissible risk note for the Stocks surface. Shown on first visit only (remembered in
 * localStorage), so it informs without nagging. The per-deposit acknowledgement and the detailed risk
 * section on the page remain the binding disclosures; this is the brief heads-up.
 */
export function StockRiskModal() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(ACK_KEY)) setOpen(true);
    } catch {
      // storage blocked (private window etc.): just don't show the one-time note
    }
  }, []);

  const close = () => {
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="risk-modal-title"
        >
          <motion.div
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card p-6"
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
            ref={ref}
            tabIndex={-1}
          >
            <h2 id="risk-modal-title" className="text-lg font-medium tracking-tight text-foreground">
              Before you trade stocks
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Stocks are directional, at-risk positions, separate from the safe USDT0 treasury and its
              guardrails. Each moves with its underlying stock, so a position can fall as well as rise.
              Deposit with that in mind.
            </p>
            <button
              onClick={close}
              className="chamfer mt-5 w-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              I understand
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
