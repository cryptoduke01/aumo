import type { Metadata } from "next";

// Standalone download page for the Aumo investor deck. Dark, on-brand, no site chrome —
// a clean surface to hand a link to and download the PDF from. Not indexed.
export const metadata: Metadata = {
  title: "Aumo · Pitch deck",
  description: "Download the Aumo investor pitch deck.",
  robots: { index: false, follow: false },
};

const PDF = "/aumo-pitch-deck.pdf";

// Brand tokens (dark-first) from brand.md — hardcoded so the page renders correctly
// independent of the app's theme variables.
const C = {
  bg: "#0a0b0d",
  card: "#101215",
  fg: "#eae8e3",
  muted: "#8a8f98",
  border: "#1e2126",
  gold: "#c8a96a",
};

export default function PitchPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: C.bg,
        color: C.fg,
        fontFamily: "var(--font-montreal), 'Helvetica Neue', Arial, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "72px 24px 96px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 960, display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark-gold.png" alt="Aumo" width={30} height={30} style={{ display: "block" }} />
          <span style={{ fontWeight: 700, fontSize: 21, letterSpacing: "-0.02em" }}>Aumo</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.22em",
              color: C.gold,
            }}
          >
            Investor deck
          </span>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.05 }}>
            Aumo pitch deck
          </h1>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5, color: C.muted, maxWidth: "52ch" }}>
            Autonomous treasury agent for stablecoins on X Layer. Ten slides on the problem, the product,
            traction, the model, and the ask.
          </p>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <a
            href={PDF}
            download
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              background: C.gold,
              color: "#0a0b0d",
              fontWeight: 500,
              fontSize: 15,
              padding: "12px 20px",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            Download PDF
          </a>
          <a
            href={PDF}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              border: `1px solid ${C.border}`,
              color: C.fg,
              fontWeight: 500,
              fontSize: 15,
              padding: "12px 20px",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            Open in new tab
          </a>
        </div>

        <div
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            overflow: "hidden",
            background: C.card,
            marginTop: 6,
          }}
        >
          <iframe
            src={`${PDF}#view=FitH`}
            title="Aumo pitch deck preview"
            style={{ width: "100%", height: "100%", border: 0, display: "block" }}
          />
        </div>
      </div>
    </main>
  );
}
