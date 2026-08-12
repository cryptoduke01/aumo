import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-image";

export const alt = "Aumo — the autonomous treasury for stablecoins on X Layer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage(
    "The autonomous treasury for stablecoins",
    "Deposit stablecoins. An AI agent earns risk-managed real-world-asset and lending yield on X Layer, every move provable on-chain.",
  );
}
