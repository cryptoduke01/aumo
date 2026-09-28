"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import site from "../site/site.module.css";
import s from "./landing.module.css";
import { phase, ScrollWords, useLeadMove, useMode } from "./scroll";

const APP = "https://app.aumo.finance";

// ── Thesis ────────────────────────────────────────────────────────────
// One statement pinned to the screen; its words light up as the reader scrolls. Text-only, so it
// pins at every width.
export function Thesis() {
  const ref = useRef<HTMLElement>(null);
  const mode = useMode(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  return (
    <section ref={ref} className={`${s.thesis} ${mode === "pinned" ? "" : s.static}`}>
      <div className={s.thesisSticky}>
        <p className={site.eyebrow}>Our thesis</p>
        <ScrollWords
          key={mode}
          className={s.thesisStatement}
          progress={scrollYProgress}
          range={[0.02, 0.7]}
          mode={mode}
          text="Idle money is a decision made by default. Aumo makes a better one, inside limits it cannot break."
        />
      </div>
    </section>
  );
}

// ── Control ───────────────────────────────────────────────────────────
// The lead lights up and moves into the header, then the vault opens from the bottom edge and
// fills the frame.
export function Control() {
  const stage = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLDivElement>(null);
  const eyebrow = useRef<HTMLParagraphElement>(null);
  const mode = useMode(640);
  const pinned = mode === "pinned";
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start start", "end end"] });
  const { x, y } = useLeadMove(sticky, lead, eyebrow, scrollYProgress, [0.32, 0.52]);
  const clipPath = useTransform(() => `inset(${(1 - phase(scrollYProgress.get(), 0.46, 0.8)) * 100}% 0% 0% 0%)`);
  const scale = useTransform(() => 1.14 - 0.14 * phase(scrollYProgress.get(), 0.46, 0.9));

  return (
    <section ref={stage} id="control" className={`${s.stage} ${s.ink} ${pinned ? "" : s.static}`}>
      <div ref={sticky} className={s.controlSticky}>
        <div className={`${s.pinHeader} ${s.controlHeader}`}>
          <p ref={eyebrow} className={site.eyebrow}>
            Guardrails
          </p>
          <motion.div ref={lead} className={s.pinLead} style={pinned ? { x, y } : { x: 0, y: 0 }}>
            <ScrollWords
              key={mode}
              progress={scrollYProgress}
              range={[0, 0.3]}
              from={0.14}
              mode={mode}
              text="Control lives in the contract, not the agent. Caps, allowlists and receipts are enforced on-chain, so taking the agent away leaves your funds exactly as safe."
            />
          </motion.div>
        </div>
        <div className={s.controlBody}>
          <motion.div className={s.visual} style={{ clipPath: pinned ? clipPath : "none" }}>
            <motion.div className="absolute inset-0" style={{ scale: pinned ? scale : 1 }}>
              <Image src="/visuals/vault-room.jpg" alt="" fill sizes="100vw" className={s.visualImg} />
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
