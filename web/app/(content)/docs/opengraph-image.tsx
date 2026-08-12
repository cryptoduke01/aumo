import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-image";

export const alt = "Aumo Docs";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(
    "Docs",
    "How Aumo works: deposit stablecoins, the agent puts them to work, and every guardrail is enforced on-chain.",
  );
}
