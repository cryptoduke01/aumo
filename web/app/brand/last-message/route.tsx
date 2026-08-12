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

// Scam-prevention / "last message in this thread" image (1600x900). Pin it or post it at the end of
// a thread so impersonators can't credibly continue it.
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
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          background: "#0a0a0a",
          padding: 80,
          color: "#ffffff",
          fontFamily: "PP Neue Montreal",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            bottom: -260,
            left: "50%",
            marginLeft: -350,
            width: 700,
            height: 700,
            borderRadius: 9999,
            background: "radial-gradient(circle, rgba(255,188,62,0.16), rgba(255,188,62,0) 70%)",
            display: "flex",
          }}
        />
        {m ? <img src={m} width={72} height={72} alt="" style={{ borderRadius: 16, marginBottom: 36 }} /> : null}
        <div style={{ display: "flex", fontSize: 74, fontWeight: 500, letterSpacing: -2, lineHeight: 1.05, maxWidth: 1200 }}>
          This is the last message in this thread
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#9a9a9a", marginTop: 30, maxWidth: 1000, lineHeight: 1.4 }}>
          Anyone messaging you beyond this claiming to be Aumo is a scam. We will never DM you first, ask for your keys, or send you a link to connect.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 48 }}>
          <div style={{ width: 10, height: 10, borderRadius: 9999, background: "#ffbc3e", display: "flex" }} />
          <span style={{ fontSize: 26, color: "#c8c8c8" }}>@aumofinance · aumo.finance</span>
        </div>
      </div>
    ),
    {
      width: 1600,
      height: 900,
      fonts: [
        { name: "PP Neue Montreal", data: font("Regular"), weight: 400, style: "normal" },
        { name: "PP Neue Montreal", data: font("Medium"), weight: 500, style: "normal" },
      ],
    },
  );
}
