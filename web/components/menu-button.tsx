"use client";

import { motion } from "motion/react";

// Two bars that animate into an X. Reduced-motion users still get the state via
// the final positions (framer respects the OS setting through its reducedMotion).
export function MenuButton({
  open,
  onClick,
  className = "",
}: {
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  const bar = "absolute left-0 h-[1.6px] w-5 rounded-full bg-current";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      className={`inline-flex size-8 items-center justify-center text-foreground ${className}`}
    >
      <span className="relative block size-5">
        <motion.span
          className={bar}
          initial={false}
          animate={open ? { top: 9, rotate: 45 } : { top: 5, rotate: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
          style={{ top: 5 }}
        />
        <motion.span
          className={bar}
          initial={false}
          animate={open ? { top: 9, rotate: -45 } : { top: 13, rotate: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
          style={{ top: 13 }}
        />
      </span>
    </button>
  );
}
