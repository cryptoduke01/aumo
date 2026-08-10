import { NextRequest, NextResponse } from "next/server";

// Clean URLs on the app subdomain. The app routes physically live under /app/*, but on
// app.aumo.finance we don't want the redundant "/app" in the address bar. This rewrites
// app-host requests to the /app/* routes internally, so app.aumo.finance/ shows the overview
// and app.aumo.finance/vault works. It's additive: the /app/* paths still resolve directly
// (they're skipped below), so nothing that already links to /app breaks.
export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  const { pathname } = req.nextUrl;

  const onAppHost = host === "app.aumo.finance" || host.startsWith("app.");
  if (!onAppHost) return NextResponse.next();

  // Already targeting the app routes directly, or an asset/api path — leave it alone.
  if (pathname.startsWith("/app")) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? "/app" : `/app${pathname}`;
  return NextResponse.rewrite(url);
}

// Never touch Next internals, the API, or static assets (anything with a file extension).
export const config = {
  matcher: ["/((?!_next/|api/|.*\\.[\\w]+$).*)"],
};
