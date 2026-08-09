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
import { xlayerTestnet } from "@/lib/chain";
import { short } from "@/lib/agent";

const btn =
  "inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

  if (isConnected && chainId !== xlayerTestnet.id) {
    return (
      <button className={`${btn} border-negative/50 text-negative`} onClick={() => switchChain({ chainId: xlayerTestnet.id })}>
        Switch to X Layer
      </button>
    );
  }

  if (isConnected) {
    return (
      <button className={btn} onClick={() => disconnect()} title="Disconnect">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden />
        <span className="font-mono text-xs">{short(address ?? null)}</span>
      </button>
    );
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
