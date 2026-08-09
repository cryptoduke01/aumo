"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useChainId,
  useSwitchChain,
  type Connector,
} from "wagmi";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { activeChain } from "@/lib/chain";
import { short, addrUrl } from "@/lib/agent";

const btn =
  "inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition-[transform,color,border-color] hover:border-foreground/40 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Prefer EIP-6963-discovered wallets; fall back to the generic injected connector
// only when nothing specific was found. Dedupe by name.
function pickWallets(connectors: readonly Connector[]): Connector[] {
  const specific = connectors.filter((c) => c.id !== "injected");
  const base = specific.length ? specific : connectors;
  const seen = new Set<string>();
  return base.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect({
    mutation: {
      onError: (e) => toast.error(e.message.split("\n")[0].slice(0, 120) || "Connection failed"),
      onSuccess: () => setOpen(false),
    },
  });
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (isConnected && chainId !== activeChain.id) {
    return (
      <button className={`${btn} border-negative/50 text-negative`} onClick={() => switchChain({ chainId: activeChain.id })}>
        Switch to {activeChain.name}
      </button>
    );
  }

  if (isConnected && address) {
    return <AccountMenu address={address} onDisconnect={() => disconnect()} />;
  }

  const wallets = pickWallets(connectors);

  return (
    <div ref={ref} className="relative">
      <button className={btn} onClick={() => setOpen((o) => !o)} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }}
            className="absolute left-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-lg shadow-black/20 md:left-auto md:right-0"
          >
            {wallets.length === 0 ? (
              <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                No wallet detected. Open this page inside your wallet&apos;s browser (OKX, MetaMask), or install a browser wallet.
              </p>
            ) : (
              wallets.map((c) => (
                <button
                  key={c.uid}
                  onClick={() => connect({ connector: c })}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" className="size-5 rounded" />
                  ) : (
                    <span className="size-5 rounded bg-surface-2" aria-hidden />
                  )}
                  <span className="text-foreground">{c.name}</span>
                </button>
              ))
            )}
            {!process.env.NEXT_PUBLIC_WC_PROJECT_ID ? (
              <p className="mt-1 border-t border-border px-3 pb-1 pt-2 text-[11px] leading-relaxed text-faint">
                On mobile, open in your wallet app&apos;s browser to connect.
              </p>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CopyIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <rect x="7" y="7" width="9" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13 7V5.6A1.6 1.6 0 0 0 11.4 4H5.6A1.6 1.6 0 0 0 4 5.6v5.8A1.6 1.6 0 0 0 5.6 13H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path d="M4.5 10.5 8 14l7.5-8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function OutIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path d="M7 13 13 7M13 7H8M13 7v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 11.5V15A1.5 1.5 0 0 1 12 16.5H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function PowerIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path d="M10 3.5v6M6.4 6a5 5 0 1 0 7.2 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AccountMenu({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div ref={ref} className="relative">
      <button className={btn} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        <span className="font-mono text-xs">{short(address)}</span>
        <svg viewBox="0 0 16 16" className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }}
            className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-lg shadow-black/20"
          >
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-accent">
                <span className="size-2 rounded-full bg-accent" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">Connected</span>
                <span className="truncate font-mono text-sm text-foreground">{short(address)}</span>
              </div>
            </div>
            <div className="my-1 h-px bg-border" />
            <button className={item} onClick={copy}>
              {copied ? <CheckIcon className="size-4 text-accent" /> : <CopyIcon className="size-4 text-muted-foreground" />}
              {copied ? "Copied" : "Copy address"}
            </button>
            <a className={item} href={addrUrl(address)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              <OutIcon className="size-4 text-muted-foreground" />
              View on explorer
            </a>
            <button
              className={`${item} text-negative hover:bg-negative/10`}
              onClick={() => {
                onDisconnect();
                setOpen(false);
              }}
            >
              <PowerIcon className="size-4" />
              Disconnect
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
