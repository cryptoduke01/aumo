import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-card ${className}`}
    >
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground">{children}</span>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-5">
      <Label>{label}</Label>
      <span className="tnum text-2xl font-medium leading-none text-foreground">
        {value}
      </span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "positive" | "negative";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "border-border text-muted-foreground",
  accent: "border-accent/40 text-accent",
  positive: "border-accent/40 text-accent",
  negative: "border-negative/40 text-negative",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "positive" }: { tone?: "positive" | "negative" | "muted" }) {
  const c =
    tone === "positive"
      ? "bg-positive"
      : tone === "negative"
        ? "bg-negative"
        : "bg-muted-foreground";
  return <span className={`inline-block size-1.5 rounded-full ${c}`} aria-hidden />;
}

/** Thin bar showing a 0..1 risk score. */
export function RiskBar({ score }: { score: number }) {
  const pctWidth = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const tone =
    score < 0.25 ? "bg-accent" : score < 0.5 ? "bg-muted-foreground" : "bg-negative";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2" aria-hidden>
      <div className={`h-full ${tone}`} style={{ width: `${pctWidth}%` }} />
    </div>
  );
}
