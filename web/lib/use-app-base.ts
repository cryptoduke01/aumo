"use client";

import { useEffect, useState } from "react";

// The app routes live under /app/*, but the middleware serves them at the root on the app
// subdomain. This returns the prefix to use for in-app links: "" on the app host (clean URLs),
// "/app" everywhere else. Defaults to "/app" for SSR/first paint; corrected on mount. Both forms
// resolve (middleware is additive), so the pre-hydration value is never broken, only less clean.
export function useAppBase() {
  const [base, setBase] = useState("/app");
  useEffect(() => {
    const h = window.location.host.split(":")[0];
    setBase(h === "app.aumo.finance" || h.startsWith("app.") ? "" : "/app");
  }, []);
  return base;
}
