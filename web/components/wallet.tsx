"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

  return (
    <>
      <button className={btn} onClick={() => setOpen(true)} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      <ConnectModal
        open={open}
        onClose={() => setOpen(false)}
        wallets={pickWallets(connectors)}
        onPick={(c) => connect({ connector: c })}
        hasWcProject={Boolean(process.env.NEXT_PUBLIC_WC_PROJECT_ID)}
      />
    </>
  );
}

function CloseIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// A centred, portalled modal for picking a wallet. Opened from any "Connect wallet" button
// (the nav one stays put); the overlay renders to <body> so it's always screen-centred and
// never clipped by a header's stacking context.
function ConnectModal({
  open,
  onClose,
  wallets,
  onPick,
  hasWcProject,
}: {
  open: boolean;
  onClose: () => void;
  wallets: Connector[];
  onPick: (c: Connector) => void;
  hasWcProject: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    const t = setTimeout(() => (focusables()[0] ?? dialogRef.current)?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus?.(); // restore focus to the button that opened the modal
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Connect a wallet"
            className="chamfer-edge relative z-10 w-full max-w-sm focus:outline-none"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="chamfer bg-surface">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex flex-col">
                  <span className="text-sm font-medium leading-none">Connect a wallet</span>
                  <span className="mt-1.5 text-[11px] text-muted-foreground">Choose how you want to connect.</span>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>

              <div className="flex flex-col gap-1 p-3">
                {wallets.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm leading-relaxed text-muted-foreground">
                    No wallet detected. Open this page in your wallet&apos;s browser (OKX, MetaMask), or install a
                    browser wallet.
                  </p>
                ) : (
                  wallets.map((c) => (
                    <button
                      key={c.uid}
                      onClick={() => onPick(c)}
                      className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left text-sm transition-colors hover:border-border hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {c.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.icon} alt="" className="size-7 rounded-md" />
                      ) : (
                        <span className="size-7 rounded-md bg-surface-2" aria-hidden />
                      )}
                      <span className="font-medium text-foreground">{c.name}</span>
                      <svg viewBox="0 0 16 16" className="ml-auto size-4 text-faint" fill="none" aria-hidden="true">
                        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ))
                )}
              </div>

              {!hasWcProject ? (
                <p className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-faint">
                  On mobile, open in your wallet app&apos;s browser to connect.
                </p>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
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
      <button className={btn} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
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
