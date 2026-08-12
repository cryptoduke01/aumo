import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Brand · Aumo",
  description: "The Aumo brand: the mark, the palette, the typeface, and how to use them.",
};

function Swatch({ name, hex, note, dark }: { name: string; hex: string; note: string; dark?: boolean }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border">
      <div className="h-24 w-full" style={{ background: hex }} />
      <div className={`flex flex-col gap-0.5 p-3 ${dark ? "" : ""}`}>
        <span className="text-sm font-medium text-foreground">{name}</span>
        <span className="font-mono text-xs uppercase text-muted-foreground">{hex}</span>
        <span className="mt-1 text-xs text-faint">{note}</span>
      </div>
    </div>
  );
}

function MarkTile({ bg, children, label }: { bg: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-40 items-center justify-center rounded-xl border border-border" style={{ background: bg }}>
        {children}
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export default function BrandPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="border-b border-border/70 py-16">
        <span className="text-xs uppercase tracking-[0.14em] text-accent">Brand · Aumo</span>
        <h1 className="mt-3 text-balance text-4xl font-medium leading-[1.05] tracking-tight sm:text-[2.9rem]">
          The Aumo brand
        </h1>
        <p className="mt-5 max-w-xl text-muted-foreground">
          A treasury should feel calm, exact, and trustworthy. The identity is deliberately restrained:
          one mark, a warm gold on ink, and a single confident typeface. Use it as shown.
        </p>
      </header>

      <article className="prose py-14">
        <h2 id="story">The story</h2>
        <p>
          Aumo is an autonomous treasury agent for stablecoins on X Layer. Someone deposits stablecoins,
          and an AI agent puts them to work in tokenized real-world-asset yield, on its own, within
          strict limits, proving every move on-chain. In three words: <em>giving a stablecoin a job.</em>
        </p>
        <p>
          The name is a tell. <strong>Au</strong> is the chemical symbol for gold, so Aumo reads as
          <em> [Au]mo</em> — value, built in before a word of explanation. Gold is old and simple, and it
          already signals worth and trust.
        </p>

        <h2 id="mark">The mark</h2>
        <p>One small shape that reads four ways at once:</p>
        <ul>
          <li><strong>The letter “a.”</strong> The wordmark, compressed to a single glyph.</li>
          <li><strong>A safe.</strong> Closed, holding something valuable inside it.</li>
          <li><strong>An agent.</strong> The slight cut on the corner says it moves and works on its own, not money sitting still. Always ready to do something.</li>
          <li><strong>Gold.</strong> Au, the chemical symbol, because value and trust should be legible before anyone explains them.</li>
        </ul>
        <p>It is the whole logo. Give it room, and never redraw, rotate, stretch, or recolour it outside the palette below.</p>
        <div className="not-prose my-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MarkTile bg="#EDEAE1" label="Ink on cream (avatar)">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark-ink.png" alt="Aumo mark, ink" className="size-16" />
          </MarkTile>
          <MarkTile bg="#0A0A0A" label="Gold on ink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark-gold.png" alt="Aumo mark, gold" className="size-16" />
          </MarkTile>
          <MarkTile bg="#171717" label="Gold, standalone">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo/mark.png" alt="Aumo mark" className="size-16" />
          </MarkTile>
        </div>

        <h2 id="palette">Palette</h2>
        <p>Ink is the ground, cream is the light surface, gold is the single accent. Everything else is a neutral.</p>
        <div className="not-prose my-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Swatch name="Ink" hex="#0A0A0A" note="Primary ground" dark />
          <Swatch name="Cream" hex="#EDEAE1" note="Light surface" />
          <Swatch name="Gold" hex="#FFBC3E" note="The only accent" />
          <Swatch name="Fog" hex="#8A8A8A" note="Secondary text" />
        </div>

        <h2 id="type">Typeface</h2>
        <p>
          PP Neue Montreal by Pangram Pangram, everywhere. It was made for screens, not adapted to them:
          clean without being cute, confident without shouting. That matters when the product’s whole
          job is holding people’s money. It works everywhere Aumo shows up, so it never gets in the way
          of the numbers. Medium for titles, Regular for body. Nothing else.
        </p>
        <div className="not-prose my-8 rounded-xl border border-border bg-surface/50 p-8">
          <div className="text-5xl font-medium tracking-tight text-foreground">Aa Gg 0123</div>
          <div className="mt-3 text-lg text-muted-foreground">The autonomous treasury for stablecoins.</div>
        </div>

        <h2 id="usage">Using the mark</h2>
        <ul>
          <li>Keep clear space around the mark. No other logo, text, or edge inside it.</li>
          <li>Below 24px, drop the outer ring. The inner solid square still reads.</li>
          <li>Never recolour outside the palette. Never rotate or tilt it. Never stretch, squash, or distort its proportions.</li>
        </ul>

        <h2 id="voice">Voice</h2>
        <ul>
          <li>Plain and precise. Say what happens, in the words a person would use.</li>
          <li>Calm, never hype. We earn yield like a treasurer, not a degen.</li>
          <li>Honest about risk. Preservation first, always.</li>
          <li>No em dashes, no emoji in reports, no filler.</li>
        </ul>

        <h2 id="downloads">Assets</h2>
        <p>Download the mark and the profile banner, or grab the full brand guideline.</p>
        <ul>
          <li><a href="/brand/logo/mark.png">Mark (PNG)</a> · <a href="/brand/mark-gold.png">Gold mark</a> · <a href="/brand/mark-ink.png">Ink mark</a></li>
          <li><a href="/brand/logo/pfp.jpg">Profile avatar</a> · <a href="/brand/banner">Social banner (1500×500)</a></li>
          <li><a href="/brand/brand-guideline.pdf">Full brand guideline (PDF)</a></li>
        </ul>
      </article>
    </div>
  );
}
