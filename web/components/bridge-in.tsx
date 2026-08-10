"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { AnimatePresence, motion } from "motion/react";
import { Panel, Label } from "@/components/ui";
import { Orb } from "@/components/orb";
import { LayerZeroLogo } from "@/components/brand";
import type { BridgeQuote } from "@/lib/bridge";

const CHAINS = [
  { key: "ethereum", label: "Ethereum", logo: "/brand/chains/ethereum.svg" },
  { key: "arbitrum", label: "Arbitrum", logo: "/brand/chains/arbitrum.svg" },
  { key: "optimism", label: "Optimism", logo: "/brand/chains/optimism.svg" },
  { key: "polygon", label: "Polygon", logo: "/brand/chains/polygon.svg" },
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
          <LayerZeroLogo className="size-3.5 rounded-[3px]" />
          Powered by LayerZero
        </span>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <ChainSelect value={source} onChange={setSource} />
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-card-2 px-3.5 py-2 transition-colors focus-within:border-primary/50">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="field-input tnum w-full min-w-0 bg-transparent text-xl font-medium outline-none placeholder:text-faint"
            placeholder="0.00"
            aria-label="Bridge amount in USDT0"
          />
          <span className="shrink-0 text-xs font-medium text-muted-foreground">USDT0</span>
        </div>
      </div>

      {!isConnected ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border px-3.5 py-2.5 text-sm text-muted-foreground">
          Connect your wallet to see the route and network fee.
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5 rounded-lg border border-border bg-card-2 p-3.5 text-sm">
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

function ChainSelect({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = CHAINS.find((c) => c.key === value) ?? CHAINS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Source chain"
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-card-2 px-3 py-2 text-sm transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.logo} alt="" className="size-5 shrink-0 rounded-full" />
        <span className="truncate text-foreground">{current.label}</span>
        <svg viewBox="0 0 16 16" className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }}
            className="absolute left-0 z-50 mt-2 w-full min-w-44 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-lg shadow-black/20"
          >
            {CHAINS.map((c) => {
              const active = c.key === value;
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(c.key);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2 ${active ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.logo} alt="" className="size-5 shrink-0 rounded-full" />
                    <span className="truncate">{c.label}</span>
                    {active ? (
                      <svg viewBox="0 0 16 16" className="ml-auto size-3.5 shrink-0 text-accent" fill="none" aria-hidden="true">
                        <path d="M3.5 8.5 6.5 11.5l6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
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
