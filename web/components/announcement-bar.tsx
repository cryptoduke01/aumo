"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "./brand";

// A dismissible top strip announcing a launch. Deliberately dark in both themes (a fixed accent
// band above the header), and remembers dismissal per viewer. Bump KEY to re-show a new message.
const KEY = "aumo-announce-spark-v2";

export function AnnouncementBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: just hide for this view */
    }
    setShow(false);
  };

  return (
    <div className="relative z-50 w-full bg-[#0a0b0d] text-[#f1eee5]">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-2.5 text-sm sm:px-8">
        <BrandLogo name="spark" className="size-5 shrink-0" />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-medium">Spark Savings is live on Aumo.</span>{" "}
          <span className="text-[#f1eee5]/60">Idle stablecoins now earn in Spark&rsquo;s savings vault on X Layer.</span>
        </p>
        <Link
          href="/app"
          className="shrink-0 rounded-full border border-white/25 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/10"
        >
          Explore &rarr;
        </Link>
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={dismiss}
          className="shrink-0 text-[#f1eee5]/50 transition-colors hover:text-[#f1eee5]"
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}
