"use client";

import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { xlayerTestnet } from "@/lib/chain";
import { short } from "@/lib/agent";

const btn =
  "inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium transition-colors hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button
        className={btn}
        disabled={isPending || !injected}
        onClick={() => injected && connect({ connector: injected })}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (chainId !== xlayerTestnet.id) {
    return (
      <button className={`${btn} border-negative/50 text-negative`} onClick={() => switchChain({ chainId: xlayerTestnet.id })}>
        Switch to X Layer
      </button>
    );
  }

  return (
    <button className={btn} onClick={() => disconnect()} title="Disconnect">
      <span className="size-1.5 rounded-full bg-positive" aria-hidden />
      <span className="font-mono text-xs">{short(address ?? null)}</span>
    </button>
  );
}
