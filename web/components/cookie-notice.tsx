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
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-[26rem] sm:bottom-6 sm:right-6"
        >
          <div className="flex flex-col gap-4 rounded-2xl border border-[var(--s-page-line)] bg-[var(--s-glass)] p-5 text-[var(--s-page-fg)] shadow-[0_1.5rem_3rem_rgba(0,0,0,0.3)] backdrop-blur-[14px]">
            <p className="text-[0.92rem] leading-relaxed text-[var(--s-page-muted)]">
              Aumo keeps your theme and wallet session in local storage and counts visits without
              tracking you. No ads, no selling your data.
            </p>
            <div className="flex items-center justify-between gap-4">
              <a
                href="/privacy"
                className="border-b border-[color-mix(in_srgb,var(--s-page-fg)_30%,transparent)] pb-0.5 text-sm transition-colors hover:border-[var(--s-signal)]"
              >
                Privacy policy
              </a>
              <button
                onClick={ack}
                className="chamfer inline-flex min-h-9 items-center bg-[var(--s-page-fg)] px-4 text-sm font-medium text-[var(--s-page)] transition-opacity hover:opacity-85"
                style={{ ["--cut" as string]: "9px" }}
              >
                Got it
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
