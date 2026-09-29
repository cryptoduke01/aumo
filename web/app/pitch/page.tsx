import type { Metadata } from "next";
import Link from "next/link";
import { AumoWordmark } from "@/components/mark";
import { ArrowUpRight } from "@/components/site-header";
import site from "@/components/site/site.module.css";

// Standalone page for the Aumo investor deck: no site chrome, a clean surface to hand a link to.
// Follows the site theme. Not indexed.
export const metadata: Metadata = {
  title: "Aumo · Investor deck",
  description: "The Aumo investor deck: eleven slides on the problem, the product, the proof and where we are.",
  robots: { index: false, follow: false },
};

const PDF = "/aumo-pitch-deck.pdf";

export default function PitchPage() {
  return (
    <main className={`${site.site} min-h-dvh`}>
      <div className="mx-auto flex w-full max-w-[84rem] flex-col px-[var(--gutter)] pb-24 pt-10">
        <Link href="/" className="self-start text-[1.15rem]" aria-label="Aumo home">
          <AumoWordmark markClass="size-[1.05em]" />
        </Link>

        <div className="mt-20">
          <p className={site.eyebrow}>Investor deck</p>
        </div>
        <h1 className="mt-6 max-w-[16ch] text-balance text-[clamp(2.8rem,5.6vw,5.6rem)] font-medium leading-[0.95] tracking-[-0.026em]">
          Aumo, in eleven slides.
        </h1>
        <p className="mt-6 max-w-[40rem] text-[1.08rem] font-normal leading-relaxed text-[var(--s-page-muted)]">
          The problem, the product, the proof, how it stays safe, and where we are. Live on X Layer mainnet
          with stablecoin yield and opt-in pools for tokenized stocks, a basket and gold.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a href={PDF} download className={site.pill}>
            Download PDF
          </a>
          <a href={PDF} target="_blank" rel="noopener noreferrer" className={site.pillGhost}>
            Open in new tab
            <ArrowUpRight className={site.pillArrow} />
          </a>
        </div>

        <div className="mt-12 aspect-video w-full overflow-hidden rounded-2xl border border-[var(--s-page-line)] bg-[var(--s-page-raise)]">
          <iframe src={`${PDF}#view=FitH`} title="Aumo investor deck" className="block h-full w-full border-0" />
        </div>
      </div>
    </main>
  );
}
