import Link from "next/link";

// Rendered inside the app layout (with AppNav), so a 404 on the app subdomain keeps the app
// chrome instead of the marketing header/footer.
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[84rem] flex-1 flex-col px-5 pb-20 sm:px-9">
      <header className="app-header">
        <span className="text-lg text-muted-foreground">404</span>
        <h1 className="app-title max-w-[16ch]">This page isn&apos;t on the allowlist.</h1>
        <span className="app-lead">Your funds and the agent are exactly where you left them.</span>
      </header>
      <Link
        href="/app"
        className="chamfer inline-flex min-h-[2.35rem] items-center self-start bg-foreground px-4 text-sm font-medium text-background transition-opacity [--cut:10px] hover:opacity-85"
      >
        Back to overview
      </Link>
    </div>
  );
}
