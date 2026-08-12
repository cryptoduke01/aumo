import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
const font = (w: string) => readFileSync(join(process.cwd(), `app/fonts/ttf/PPNeueMontreal-${w}.ttf`));
const mark = () => {
  try {
    return `data:image/png;base64,${readFileSync(join(process.cwd(), "public/brand/logo/mark.png")).toString("base64")}`;
  } catch {
    return "";
  }
};

// X / social profile banner (1500x500). Content sits centred so the avatar (bottom-left overlay)
// never clashes with it.
export async function GET() {
  const m = mark();
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
          background: "#0a0a0a",
          padding: "0 110px",
          color: "#ffffff",
          fontFamily: "PP Neue Montreal",
          position: "relative",
          overflow: "hidden",
          textAlign: "right",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -220,
            left: -160,
            width: 700,
            height: 700,
            borderRadius: 9999,
            background: "radial-gradient(circle, rgba(255,188,62,0.20), rgba(255,188,62,0) 70%)",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {m ? <img src={m} width={76} height={76} alt="" style={{ borderRadius: 16 }} /> : null}
          <span style={{ fontSize: 56, fontWeight: 500, letterSpacing: -1.5 }}>aumo</span>
        </div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 500, letterSpacing: -1.2, marginTop: 26, color: "#f2f2f2" }}>
          The autonomous treasury for stablecoins.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22 }}>
          <div style={{ width: 10, height: 10, borderRadius: 9999, background: "#ffbc3e", display: "flex" }} />
          <span style={{ fontSize: 27, color: "#9a9a9a" }}>aumo.finance</span>
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
