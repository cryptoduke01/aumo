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
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
