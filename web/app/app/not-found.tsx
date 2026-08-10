import Link from "next/link";
import { AumoMark } from "@/components/mark";

// Rendered inside the app layout (with AppNav), so a 404 on the app subdomain keeps the app
// chrome instead of the marketing header/footer.
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-5 px-4 py-24 text-center">
      <AumoMark className="size-8 text-primary" />
      <p className="tnum text-4xl font-medium tracking-tight text-foreground">404</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page isn&apos;t on the allowlist. Your funds and the agent are exactly where you left them.
      </p>
      <Link
        href="/app"
        className="rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:border-foreground/40"
      >
        Back to overview
      </Link>
    </div>
  );
}
