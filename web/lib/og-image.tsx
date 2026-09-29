import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// One template for every page's link preview (1200x630), in the site's language: a dark
// photograph with one seam of Sovereign light, the page title set large in PP Neue Montreal with a
// light optical pull on the tracking, and the lockup top-left. The bottom band stays empty because
// X draws the page title over the card's bottom-left corner.

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
  const mark = dataUri("public/brand/mark-gold.png", "image/png"); // tightly cropped mark
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
              <img src={mark} width={34} height={34} alt="" />
            ) : null}
            <span style={{ fontSize: 32, fontWeight: 500, letterSpacing: -0.6, color: BONE }}>aumo</span>
          </div>

          {/* title + subtitle */}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 900 }}>
            <div
              style={{
                display: "flex",
                fontSize: big ? 88 : 66,
                fontWeight: 500,
                lineHeight: 1.0,
                letterSpacing: big ? -2.4 : -1.7,
                color: BONE,
                textWrap: "balance",
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
                letterSpacing: 0,
                color: "rgba(241,238,229,0.66)",
                maxWidth: 860,
              }}
            >
              {subtitle}
            </div>
          </div>

          {/* keep the bottom band empty: X overlays the page title across the card's bottom-left */}
          <div style={{ display: "flex", height: 64 }} />
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
