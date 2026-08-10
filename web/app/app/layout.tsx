import type { ReactNode } from "react";
import { AppNav } from "@/components/nav";
import { SiteFooter } from "@/components/site-footer";
import { Toaster } from "@/components/toaster";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* quiet dithered wash behind the whole app, same brand texture as the site, kept faint so
          it never fights the data. Fixed so it stays put as the dashboard scrolls. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[70vh] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dither-images/HMtauliaQAAqwjB.jpeg"
          alt=""
          className="h-full w-full object-cover object-top opacity-[0.06] [mask-image:linear-gradient(to_bottom,#000_0%,transparent_82%)] [filter:saturate(0.85)_contrast(1.05)]"
        />
        <div
          className="absolute inset-0 mix-blend-soft-light"
          style={{ background: "radial-gradient(60% 40% at 50% 8%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 66%)" }}
        />
      </div>
      <AppNav />
      {children}
      <SiteFooter />
      <Toaster />
    </>
  );
}
