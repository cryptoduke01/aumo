import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// One template for every page's link preview (1200x630), in the site's language: a dark
// photograph with one seam of Sovereign light, the page title set large and tight bottom-left in
// PP Neue Montreal, the lockup top-left and the domain bottom-right.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const FONT = "PP Neue Montreal";
const BONE = "#f1eee5";

function dataUri(rel: string, mime: string): string {
  try {
    const buf = readFileSync(join(process.cwd(), rel));
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

// The brand face as ttf: Satori (next/og) can't read the woff2 originals.
function fontData(weight: "Regular" | "Medium") {
  return readFileSync(join(process.cwd(), `app/fonts/ttf/PPNeueMontreal-${weight}.ttf`));
}

export function renderOgImage(title: string, subtitle: string, image = "public/visuals/hero.jpg") {
  const photo = dataUri(image, "image/jpeg");
  const mark = dataUri("public/brand/logo/mark.png", "image/png");
  const big = title.length <= 28;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#000",
          color: BONE,
          fontFamily: FONT,
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            width={1200}
            height={630}
            style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }}
          />
        ) : null}
        {/* shade: keeps the left and the bottom legible, lets the photograph breathe on the right */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: "flex",
            backgroundImage:
              "linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.05) 100%), linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.7) 100%)",
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "56px 64px",
          }}
        >
          {/* lockup */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {mark ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mark} width={40} height={40} alt="" />
            ) : null}
            <span style={{ fontSize: 32, fontWeight: 500, letterSpacing: -1, color: BONE }}>aumo</span>
          </div>

          {/* title + subtitle, bottom-left */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 900 }}>
            <div
              style={{
                display: "flex",
                fontSize: big ? 92 : 68,
                fontWeight: 500,
                lineHeight: 0.96,
                letterSpacing: big ? -5 : -3.6,
                color: BONE,
              }}
            >
              {title}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 26,
                fontSize: 26,
                fontWeight: 400,
                lineHeight: 1.4,
                letterSpacing: -0.3,
                color: "rgba(241,238,229,0.66)",
                maxWidth: 780,
              }}
            >
              {subtitle}
            </div>
          </div>

          {/* footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", width: 9, height: 9, background: "#ffbc3e" }} />
              <span style={{ fontSize: 22, color: "rgba(241,238,229,0.72)" }}>Autonomous treasury on X Layer</span>
            </div>
            <span style={{ fontSize: 22, color: "rgba(241,238,229,0.72)" }}>aumo.finance</span>
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: FONT, data: fontData("Regular"), weight: 400, style: "normal" },
        { name: FONT, data: fontData("Medium"), weight: 500, style: "normal" },
      ],
    },
  );
}
