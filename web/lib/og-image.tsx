import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// One branded template for every page's link preview (1200x630). Dark ground, the gold mark, a soft
// gold glow, the page's own title + subtitle. Uses next/og's bundled default font, so it needs no
// external font fetch and renders identically everywhere.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const ACCENT = "#ffbc3e";
const BG = "#0a0a0a";
const FONT = "PP Neue Montreal";

function markDataUri(): string {
  try {
    const buf = readFileSync(join(process.cwd(), "public/brand/logo/mark.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

// The brand face, decompressed to ttf so Satori (next/og) can use it — the woff2 originals aren't
// supported by the OG renderer.
function fontData(weight: "Regular" | "Medium" | "Bold") {
  return readFileSync(join(process.cwd(), `app/fonts/ttf/PPNeueMontreal-${weight}.ttf`));
}

export function renderOgImage(title: string, subtitle: string) {
  const mark = markDataUri();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: 72,
          color: "#ffffff",
          position: "relative",
          overflow: "hidden",
          fontFamily: FONT,
        }}
      >
        {/* soft gold glow, top-right */}
        <div
          style={{
            position: "absolute",
            top: -260,
            right: -220,
            width: 680,
            height: 680,
            borderRadius: 9999,
            background: `radial-gradient(circle, rgba(255,188,62,0.20), rgba(255,188,62,0) 70%)`,
            display: "flex",
          }}
        />

        {/* brand lockup */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {mark ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mark} width={56} height={56} alt="" style={{ borderRadius: 12 }} />
          ) : null}
          <span style={{ fontSize: 34, fontWeight: 500, letterSpacing: -1, color: "#f5f5f5" }}>aumo</span>
        </div>

        {/* title + subtitle */}
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 940 }}>
          <div style={{ display: "flex", fontSize: title.length > 34 ? 60 : 76, fontWeight: 500, lineHeight: 1.05, letterSpacing: -2, color: "#ffffff" }}>
            {title}
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 28, lineHeight: 1.35, color: "#8a8a8a", maxWidth: 860 }}>
            {subtitle}
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", width: 10, height: 10, borderRadius: 9999, background: ACCENT }} />
            <span style={{ fontSize: 24, color: "#9a9a9a" }}>aumo.finance</span>
          </div>
          <span style={{ fontSize: 24, color: "#6a6a6a" }}>Autonomous treasury on X Layer</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: FONT, data: fontData("Regular"), weight: 400, style: "normal" },
        { name: FONT, data: fontData("Medium"), weight: 500, style: "normal" },
        { name: FONT, data: fontData("Bold"), weight: 700, style: "normal" },
      ],
    },
  );
}
