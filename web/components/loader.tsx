import { Orb } from "./orb";

// A branded loading state: the thinking orb plus a quiet label. Used wherever the
// app is waiting on the agent or the chain, instead of a bare skeleton.
export function Loader({ label = "loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-faint">
      <Orb className="size-6 text-accent" />
      <span className="text-xs">{label}</span>
    </div>
  );
}
