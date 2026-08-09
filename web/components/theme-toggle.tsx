"use client";

import { useEffect, useState } from "react";

// Theme control as a contrast mark - a disc split ink/paper, the brand's own
// light/dark duality - not the stock sun-moon pill. Persists the choice and tells
// the canvas field to re-read its colour so the atmosphere flips with the theme.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const cur = (document.documentElement.getAttribute("data-theme") ||
      "dark") as "dark" | "light";
    setTheme(cur);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("aumo-theme", next);
    } catch {}
    window.dispatchEvent(new Event("themechange"));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="inline-flex size-8 items-center justify-center text-foreground transition-colors hover:text-muted-foreground"
    >
      <svg viewBox="0 0 20 20" className="size-[1.05rem]" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="7.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        {/* right half filled - the ink side of the disc */}
        <path d="M10 2.75 A7.25 7.25 0 0 1 10 17.25 Z" fill="currentColor" />
      </svg>
    </button>
  );
}
