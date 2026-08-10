import Link from "next/link";
import { AsciiField } from "@/components/ascii-field";
import { Grain } from "@/components/grain";
import { AumoMark } from "@/components/mark";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata = {
  title: "Not found · Aumo",
};

function ArrowOut({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M5 11L11 5M11 5H6M11 5V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <section className="relative isolate flex flex-1 items-center overflow-hidden">
        <AsciiField className="opacity-40 [mask-image:radial-gradient(120%_90%_at_50%_40%,#000_10%,transparent_72%)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-2xl"
          style={{ background: "radial-gradient(circle, var(--primary) 0%, transparent 62%)" }}
        />
        <Grain />
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-5 py-28 text-center sm:px-8">
          <span className="relative inline-flex size-12 items-center justify-center">
            <AumoMark className="size-9 text-primary" />
          </span>
          <p className="tnum mt-8 text-6xl font-medium tracking-tight text-foreground sm:text-7xl">404</p>
          <h1 className="mt-5 text-balance text-xl font-medium tracking-tight sm:text-2xl">
            This route isn&apos;t on the allowlist.
          </h1>
          <p className="mt-3 max-w-md text-balance text-muted-foreground">
            The page you asked for doesn&apos;t exist, or it moved. Nothing is lost, your funds and
            the agent are exactly where you left them.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="chamfer inline-flex items-center bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
              style={{ ["--cut" as string]: "9px" }}
            >
              Back to home
            </Link>
            <a
              href="https://app.aumo.finance"
              className="group inline-flex items-center gap-1.5 rounded-lg border border-border px-5 py-2.5 text-sm text-foreground transition-colors hover:border-foreground/40"
            >
              Launch app
              <ArrowOut className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
