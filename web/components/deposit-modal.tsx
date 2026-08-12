"use client";

import { AnimatePresence, motion } from "motion/react";
import { Orb } from "./orb";

/**
 * The moment after a deposit confirms. Instead of a terse toast, we mark the handoff: the depositor
 * has done their one job, and the agent takes it from here. Calm, on-brand, honest (it does not
 * promise returns — it says the capital is now being put to work).
 */
export function DepositModal({
  open,
  amount,
  symbol,
  onClose,
  onView,
}: {
  open: boolean;
  amount: string;
  symbol: string;
  onClose: () => void;
  onView: () => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card p-8 text-center"
            initial={{ opacity: 0, scale: 0.94, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ambient glow behind the orb */}
            <div
              className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-48 rounded-full bg-accent/20 blur-3xl"
              aria-hidden
            />
            <div className="relative flex flex-col items-center gap-5">
              <Orb className="size-12 text-accent" />

              <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-medium tracking-tight text-foreground">Your capital is at work</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Aumo is scoring every venue and putting your{" "}
                  <span className="tnum text-foreground">
                    {amount} {symbol}
                  </span>{" "}
                  to work in the best risk-adjusted yield, preservation first. You don&apos;t have to
                  do a thing. Sit back.
                </p>
              </div>

              <div className="mt-1 flex w-full flex-col gap-2">
                <button
                  onClick={onView}
                  className="chamfer w-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Watch it work
                </button>
                <button
                  onClick={onClose}
                  className="w-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Done
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
