"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const KEY = "aumo-cookie-ack";

// Honest, minimal cookie notice. Aumo only uses local storage that the app needs to work (your theme,
// your wallet session) plus basic analytics. No selling data, no ad tracking. One acknowledgement,
// remembered locally, never nags again.
export function CookieNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      /* storage blocked: don't show */
    }
  }, []);

  const ack = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4 sm:px-6"
        >
          <div className="flex w-full max-w-3xl flex-col items-start gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              We use cookies and local storage to keep the app working (your theme and wallet session)
              and to understand usage. No ad tracking, no selling your data.{" "}
              <a href="/privacy" className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
                Privacy
              </a>
              .
            </p>
            <button
              onClick={ack}
              className="chamfer shrink-0 whitespace-nowrap bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Got it
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
