import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // On the app subdomain, land visitors straight on the app.
      beforeFiles: [
        {
          source: "/",
          has: [{ type: "host", value: "app.aumo.finance" }],
          destination: "/app",
        },
      ],
      afterFiles: [
        // Clean URL for the investor pitch deck (self-contained HTML in /public).
        { source: "/pitch", destination: "/pitch.html" },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
