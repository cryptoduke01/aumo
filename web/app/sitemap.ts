import type { MetadataRoute } from "next";

// Every public, indexable page on the marketing domain. The /app dashboard lives on the app
// subdomain and is a live tool, not SEO surface, so it is intentionally excluded.
const BASE = "https://aumo.finance";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "", priority: 1.0, freq: "weekly" },
    { path: "/ecosystem", priority: 0.9, freq: "monthly" },
    { path: "/research", priority: 0.8, freq: "monthly" },
    { path: "/whitepaper", priority: 0.8, freq: "monthly" },
    { path: "/docs", priority: 0.7, freq: "monthly" },
    { path: "/privacy", priority: 0.3, freq: "yearly" },
    { path: "/terms", priority: 0.3, freq: "yearly" },
  ];
  return routes.map((r) => ({
    url: `${BASE}${r.path}`,
    lastModified: now,
    changeFrequency: r.freq,
    priority: r.priority,
  }));
}
