"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Panel, Label, Badge } from "@/components/ui";
import type { BridgeQuote } from "@/lib/bridge";

const CHAINS = [
  { key: "ethereum", label: "Ethereum" },
  { key: "arbitrum", label: "Arbitrum" },
  { key: "optimism", label: "Optimism" },
  { key: "polygon", label: "Polygon" },
];

export function BridgeIn() {
  const { address } = useAccount();
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
    if (!amount || Number(amount) <= 0) {
      setQuote(null);
      setError(null);
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
          setError(data.error ?? "quote failed");
          setQuote(null);
        } else {
          setQuote(data as BridgeQuote);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("couldn't fetch quote");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [params, amount]);

  return (
    <Panel className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <Label>Fund from another chain</Label>
        <Badge tone="neutral">via LayerZero</Badge>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {CHAINS.map((c) => (
          <button
            key={c.key}
            onClick={() => setSource(c.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              source === c.key ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card-2 px-3 py-2.5 focus-within:border-foreground/40">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          className="tnum w-full bg-transparent font-mono text-lg outline-none"
          aria-label="Bridge amount in USDT0"
        />
        <span className="text-sm text-muted-foreground">USDT0</span>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card-2 p-4 text-sm">
        <Row label="Route" value={quote ? `${quote.source} → ${quote.destination}` : loading ? "…" : "-"} />
        <Row
          label="Bridge fee"
          value={quote ? `${Number(quote.nativeFeeEth).toFixed(6)} (gas)` : loading ? "…" : "-"}
        />
        <Row label="Lands as" value="USDT0 on X Layer, ready to deposit" />
        {error ? <span className="text-xs text-negative">{error}</span> : null}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Live quote from USDT0&apos;s native LayerZero OFT. Bridging executes on mainnet from your wallet on
        the source chain; here on testnet it previews the real route and fee.
      </p>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum font-mono text-xs">{value}</span>
    </div>
  );
}
