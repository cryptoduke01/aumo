import Image from "next/image";
import type { ReactNode } from "react";
import s from "./page-hero.module.css";

// The hero every content page opens with. Pass `image` for a photographic hero,
// or leave it out for a quiet oversized title on the page ground (legal pages). In light mode the
// photograph slides to the right and fades into the Off-White ground so the title sits on paper.
export function PageHero({
  eyebrow,
  title,
  lead,
  meta,
  image,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  meta?: ReactNode;
  image?: string;
}) {
  return (
    <section className={`${s.hero} ${image ? s.photo : s.plain}`}>
      {image ? (
        <>
          <div className={s.image} aria-hidden>
            <Image src={image} alt="" fill priority sizes="100vw" />
          </div>
          <div className={s.shade} aria-hidden />
        </>
      ) : null}
      <div className={s.inner}>
        <p className={s.eyebrow}>{eyebrow}</p>
        <h1 className={s.title}>{title}</h1>
        {lead ? <p className={s.lead}>{lead}</p> : null}
        {meta ? <p className={s.meta}>{meta}</p> : null}
      </div>
    </section>
  );
}

// Author line used under research-style heroes.
export function Byline() {
  return (
    <div className={s.byline}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/duke.jpg" alt="Duke" className={s.avatar} />
      <div className={s.who}>
        <span>Duke</span>
        <a href="https://x.com/dukedotsol" target="_blank" rel="noreferrer">
          @dukedotsol · Aumo · X Layer
        </a>
      </div>
    </div>
  );
}

// A labelled summary block (abstract, one-paragraph summary) under a hero.
export function Abstract({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className={s.abstract}>
      <p className={s.abstractLabel}>{label}</p>
      <p>{children}</p>
      {foot}
    </div>
  );
}
