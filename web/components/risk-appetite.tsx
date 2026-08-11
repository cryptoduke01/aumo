"use client";

import { useAccount, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useEffect } from "react";
import { toast } from "sonner";
import { POOL, poolAbi, activeChain } from "@/lib/chain";
import { Label } from "@/components/ui";

const TIERS: { tier: number; label: string; blurb: string }[] = [
  { tier: 1, label: "Conservative", blurb: "Safety first. Lower yield, tightest guardrails." },
  { tier: 2, label: "Moderate", blurb: "Balanced risk-adjusted yield." },
  { tier: 3, label: "Bold", blurb: "Reach for yield, up to the pool's hard cap." },
];

/**
 * Depositor risk-appetite control. Each depositor's choice is share-weighted into the pool's
 * effective appetite; the agent never exceeds the owner's hard ceiling, so this only ever steers the
 * pool safer or up to that bound. A preference signal, never a fund movement.
 */
export function RiskAppetite() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== undefined && chainId !== activeChain.id;

  const read = useReadContract({
    address: POOL,
    abi: poolAbi,
    functionName: "riskAppetiteOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 15000 },
  });
  const current = Number(read.data ?? 0);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  useEffect(() => {
    if (receipt.data?.status === "success") {
      read.refetch();
      toast.success("Risk appetite updated");
    } else if (receipt.data?.status === "reverted") {
      toast.error("Transaction reverted");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  function set(tier: number) {
    if (wrongChain) {
      switchChain({ chainId: activeChain.id });
      return;
    }
    writeContract({ address: POOL, abi: poolAbi, functionName: "setRiskAppetite", args: [tier], chainId: activeChain.id });
  }

  // Hide entirely on a pool that predates this feature (the read reverts) so there's no dead control.
  if (!isConnected || read.isError) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Your risk appetite</Label>
        <span className="text-[11px] text-faint">Steers the pool, capped on-chain</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {TIERS.map((t) => {
          const active = current === t.tier;
          return (
            <button
              key={t.tier}
              type="button"
              onClick={() => set(t.tier)}
              disabled={isPending || receipt.isLoading}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                active
                  ? "border-accent bg-accent/10"
                  : "border-border bg-card-2 hover:border-foreground/30"
              }`}
            >
              <span className={`text-sm font-medium ${active ? "text-accent" : "text-foreground"}`}>
                {t.label}
              </span>
              <span className="text-[11px] leading-snug text-muted-foreground">{t.blurb}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        {wrongChain
          ? `Switch to ${activeChain.name} to set your appetite.`
          : "The agent share-weights every depositor's choice and never exceeds the pool's hard risk cap."}
      </p>
    </div>
  );
}
