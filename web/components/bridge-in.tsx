"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Panel, Label } from "@/components/ui";
import { Orb } from "@/components/orb";
import { LayerZeroLogo } from "@/components/brand";
import type { BridgeQuote } from "@/lib/bridge";

const CHAINS = [
  { key: "ethereum", label: "Ethereum" },
  { key: "arbitrum", label: "Arbitrum" },
  { key: "optimism", label: "Optimism" },
  { key: "polygon", label: "Polygon" },
];

export function BridgeIn() {
  const { address, isConnected } = useAccount();
  const [source, setSource] = useState("arbitrum");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const params = useMemo(() => {
    const q = new URLSearchParams({ source, amount: amount || "0" });
    if (address) q.set("to", address);
    return q.toString();
  }, [source, amount, address]);

  useEffect(() => {
    // Only quote once a wallet is connected; the fee depends on the recipient,
    // and there's nothing to bridge to before then.
    if (!address || !amount || Number(amount) <= 0) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/bridge-quote?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't get a quote");
          setQuote(null);
        } else {
          setQuote(data as BridgeQuote);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Couldn't get a quote");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [params, amount, address]);

  return (
    <Panel className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <Label>Fund from another chain</Label>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
          <LayerZeroLogo className="size-3.5 text-muted-foreground" />
          Powered by LayerZero
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {CHAINS.map((c) => (
          <button
            key={c.key}
            onClick={() => setSource(c.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-[transform,color,border-color] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              source === c.key
                ? "border-primary/60 bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card-2 px-4 py-3 transition-colors focus-within:border-primary/50">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="tnum w-full bg-transparent text-2xl font-medium outline-none placeholder:text-faint"
          placeholder="0.00"
          aria-label="Bridge amount in USDT0"
        />
        <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">USDT0</span>
      </div>

      {!isConnected ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3.5 text-sm text-muted-foreground">
          Connect your wallet to see the route and network fee.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card-2 p-4 text-sm">
          <Row
            label="Route"
            value={
              quote ? (
                <span className="flex items-center gap-1.5">
                  {quote.source} <span className="text-faint">→</span> {quote.destination}
                </span>
              ) : loading ? (
                <Orb className="size-4 text-accent" />
              ) : (
                "·"
              )
            }
          />
          <Row
            label="Network fee"
            value={quote ? `${Number(quote.nativeFeeEth).toFixed(6)} (gas)` : loading ? <Orb className="size-4 text-accent" /> : "·"}
          />
          <Row label="Arrives as" value="USDT0 on X Layer, ready to deposit" />
          {error ? <span className="text-xs text-negative">{error}</span> : null}
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Move USDT0 from another chain straight into Aumo. We show the real route and network fee
        before you send. Nothing moves until you confirm in your wallet.
      </p>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-[20px] items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum flex items-center justify-end text-xs text-foreground">{value}</span>
    </div>
  );
}
