import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-image";

export const alt = "Aumo Research";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(
    "Research",
    "A guardrailed, self-evolving reasoning agent for autonomous stablecoin treasury management.",
  );
}
