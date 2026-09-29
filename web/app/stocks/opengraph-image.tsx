// card v2 (Sep 2026): lighter tracking scale; bottom band left clear for X's title overlay.
import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-image";

export const alt = "Stocks are live on Aumo";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(
    "Stocks are live on Aumo",
    "Onchain exposure to NVIDIA, Apple, Microsoft and Meta on X Layer, each in its own pool, with market hours enforced on-chain.",
    "public/visuals/pool-stocks.jpg",
  );
}
