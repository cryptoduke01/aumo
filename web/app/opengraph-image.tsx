// card v2 (Sep 2026): lighter tracking scale; bottom band left clear for X's title overlay.
import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-image";

export const alt = "Aumo, the autonomous treasury for stablecoins on X Layer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(
    "The autonomous treasury for stablecoins",
    "An AI agent puts idle USDT0 to work on X Layer, with opt-in pools for tokenized stocks and gold. Every move bounded and provable on-chain.",
    "public/visuals/hero.jpg",
  );
}
