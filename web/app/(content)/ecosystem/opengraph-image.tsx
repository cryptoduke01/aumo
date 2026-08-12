import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-image";

export const alt = "Aumo Ecosystem";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(
    "An AI-RWA treasury that grows the ecosystem it earns in",
    "How Aumo brings idle dollar liquidity into X Layer's real-world-asset economy, and deepens the protocols it earns in.",
  );
}
