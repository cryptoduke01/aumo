import { addrUrl } from "@/lib/agent";
import { POOL } from "@/lib/chain";

// The trust surface: everything here is verifiable, which is exactly the wedge against simulated
// dashboards and inflated stats. Every claim maps to something real in the repo or on-chain: 76
// contract + 58 agent tests, three adapters proven on a mainnet fork, guardrails the contract
// enforces, a signing key sealed in a Turnkey TEE, and a live tx behind every decision. Context-free
// (no routing), so it drops into both the app Overview and the marketing landing.
const proofs: { value: string; label: string; accent?: boolean }[] = [
  { value: "134", label: "tests" },
  { value: "3", label: "adapters fork-proven" },
  { value: "On-chain", label: "guardrails enforced" },
  { value: "Turnkey TEE", label: "sealed signer", accent: true },
  { value: "Every move", label: "a live receipt" },
];

export function ProofStrip({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-5 py-3.5 text-left ${className}`}>
      <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-faint">
        <span className="size-1.5 rounded-full bg-accent" /> Proof, not promises
      </span>
      {proofs.map((p) => (
        <span key={p.label} className="flex items-baseline gap-1.5">
          <span className={`tnum text-sm font-medium ${p.accent ? "text-accent" : "text-foreground"}`}>{p.value}</span>
          <span className="text-xs text-muted-foreground">{p.label}</span>
        </span>
      ))}
      <a
        href={addrUrl(POOL)}
        target="_blank"
        rel="noreferrer"
        className="ml-auto flex items-baseline gap-1.5 text-xs font-medium text-accent transition-opacity hover:opacity-80"
      >
        Contracts public ↗
      </a>
    </div>
  );
}
