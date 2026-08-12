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

// X / social profile banner (1500x500). Content sits centred so the avatar (bottom-left overlay)
// never clashes with it.
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
          justifyContent: "center",
          alignItems: "flex-end",
          backgroundColor: "#0a0a0a",
          padding: "0 110px",
          color: "#ffffff",
          fontFamily: "PP Neue Montreal",
          position: "relative",
          overflow: "hidden",
          textAlign: "right",
        }}
      >
        {/* brand dither backdrop */}
        {d ? (
          <img
            src={d}
            width={1500}
            height={500}
            alt=""
            style={{ position: "absolute", top: 0, left: 0, width: 1500, height: 500, objectFit: "cover", objectPosition: "50% 42%" }}
          />
        ) : null}
        {/* darken for legibility, heavier toward the content on the right */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1500,
            height: 500,
            display: "flex",
            background: "linear-gradient(90deg, rgba(10,10,10,0.42) 0%, rgba(10,10,10,0.66) 55%, rgba(10,10,10,0.80) 100%)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {m ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 108,
                height: 108,
                borderRadius: 24,
                background: "#EDEAE1",
              }}
            >
              <img src={m} width={64} height={64} alt="" />
            </div>
          ) : null}
          <span style={{ fontSize: 56, fontWeight: 500, letterSpacing: -1.5 }}>aumo</span>
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 500, letterSpacing: -1.2, marginTop: 26, color: "#f2f2f2" }}>
          The autonomous treasury for stablecoins.
        </div>
      </div>
    ),
    {
      width: 1500,
      height: 500,
      fonts: [
        { name: "PP Neue Montreal", data: font("Regular"), weight: 400, style: "normal" },
        { name: "PP Neue Montreal", data: font("Medium"), weight: 500, style: "normal" },
      ],
    },
  );
}
