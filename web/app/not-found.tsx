import Link from "next/link";
import { ArrowUpRight, SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import site from "@/components/site/site.module.css";

export const metadata = {
  title: "Not found · Aumo",
};

export default function NotFound() {
  return (
    <div className={`${site.site} flex flex-1 flex-col`}>
      <SiteHeader />
      <main className="flex flex-1 items-end">
        <section className="w-full px-[var(--gutter)] pb-20 pt-32 sm:pt-44">
          <p className={site.eyebrow}>404</p>
          <h1 className="mt-6 max-w-[16ch] text-balance text-[clamp(2.8rem,6vw,6rem)] font-medium leading-[0.95] tracking-[-0.026em]">
            This route isn&apos;t on the allowlist.
          </h1>
          <p className="mt-6 max-w-md text-[1.05rem] font-normal leading-relaxed text-[var(--s-page-muted)]">
            The page you asked for doesn&apos;t exist, or it moved. Nothing is lost: your funds and the agent are exactly
            where you left them.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/" className={site.pill}>
              Back to home
            </Link>
            <a href="https://app.aumo.finance" className={site.pillGhost}>
              Launch app
              <ArrowUpRight className={site.pillArrow} />
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
