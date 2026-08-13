import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
const font = (w: string) => readFileSync(join(process.cwd(), `app/fonts/ttf/PPNeueMontreal-${w}.ttf`));
const asset = (rel: string, mime: string) => {
  try {
    return `data:${mime};base64,${readFileSync(join(process.cwd(), rel)).toString("base64")}`;
  } catch {
    return "";
  }
};
const inkMark = () => asset("public/brand/mark-ink.png", "image/png");
const dither = () => asset("public/dither-images/HMtauliaQAAqwjB.jpeg", "image/jpeg");

// Launch article hero / OG cover (1200x630). Brand dither ground, faded and darkened so it reads
// as texture, not noise. Cream mark tile matches the avatar; gold is the single accent.
export async function GET() {
  const m = inkMark();
  const d = dither();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0a0a0a",
          padding: "62px 72px",
          color: "#f2f2f2",
          fontFamily: "PP Neue Montreal",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {d ? (
          <img
            src={d}
            width={1200}
            height={630}
            alt=""
            style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover", objectPosition: "50% 38%", opacity: 0.5 }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: "flex",
            background: "linear-gradient(115deg, rgba(10,10,10,0.93) 0%, rgba(10,10,10,0.74) 52%, rgba(10,10,10,0.56) 100%)",
          }}
        />

        {/* top: mark + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
          {m ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 62, height: 62, borderRadius: 14, background: "#EDEAE1" }}>
              <img src={m} width={37} height={37} alt="" />
            </div>
          ) : null}
          <span style={{ display: "flex", fontSize: 34, fontWeight: 500, letterSpacing: -1 }}>aumo</span>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
          <span style={{ display: "flex", fontSize: 72, fontWeight: 500, letterSpacing: -2.6, lineHeight: 1.04, color: "#ffffff", maxWidth: 940 }}>
            A stablecoin treasury that manages itself.
          </span>
        </div>

        {/* bottom: url only */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-end", position: "relative" }}>
          <span style={{ display: "flex", fontSize: 24, fontWeight: 500, color: "#FFBC3E" }}>aumo.finance</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "PP Neue Montreal", data: font("Regular"), weight: 400, style: "normal" },
        { name: "PP Neue Montreal", data: font("Medium"), weight: 500, style: "normal" },
      ],
    },
  );
}
