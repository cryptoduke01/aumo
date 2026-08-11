import type { MetadataRoute } from "next";

// Tell crawlers everything on the marketing domain is fair game, and point them at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://aumo.finance/sitemap.xml",
    host: "https://aumo.finance",
  };
}
