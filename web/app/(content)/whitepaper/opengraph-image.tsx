// card v2 (Sep 2026): lighter tracking scale; bottom band left clear for X's title overlay.
import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-image";

export const alt = "Aumo Whitepaper";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(
    "Whitepaper",
    "Aumo: an autonomous, guardrailed treasury agent for stablecoins, earning real-world-asset yield on X Layer.",
    "public/visuals/note-whitepaper.jpg",
  );
}
