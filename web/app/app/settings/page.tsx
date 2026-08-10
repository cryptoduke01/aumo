"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useChainId, useDisconnect, useReadContracts, useSwitchChain } from "wagmi";
import { toast } from "sonner";
import { POOL, USDT0, poolAbi, erc20Abi, activeChain, isMainnet } from "@/lib/chain";
import { addrUrl, short } from "@/lib/agent";
import { Panel, Label } from "@/components/ui";
import { ConnectButton } from "@/components/wallet";

const DEC = 6;
const fmt = (v: bigint | undefined) =>
  v === undefined ? "-" : (Number(v) / 10 ** DEC).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function SettingsPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== activeChain.id;

  const reads = useReadContracts({
    contracts: [
      { address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [address!] },
      { address: POOL, abi: poolAbi, functionName: "maxWithdraw", args: [address!] },
    ],
    query: { enabled: Boolean(address) && !wrongChain },
  });
  const walletBal = reads.data?.[0]?.result as bigint | undefined;
  const position = reads.data?.[1]?.result as bigint | undefined;

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1 border-b border-border pb-6">
        <h1 className="text-xl font-medium tracking-tight">Settings</h1>
        <span className="text-sm text-muted-foreground">Your wallet, appearance, and the contracts this app talks to.</span>
      </header>

      {/* Wallet */}
      <Panel className="p-5">
        <Label>Wallet</Label>
        {!isConnected || !address ? (
          <div className="mt-4 flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">Connect a wallet to deposit, withdraw, and see your position.</p>
            <ConnectButton />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card-2 px-3.5 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-accent">
                <span className="size-2 rounded-full bg-accent" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">Connected · {activeChain.name}</span>
                <span className="truncate text-sm text-foreground">{short(address)}</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={copy} className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:border-foreground/40">Copy</button>
                <a href={addrUrl(address)} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:border-foreground/40">Explorer</a>
              </div>
            </div>

            {wrongChain ? (
              <button
                onClick={() => switchChain({ chainId: activeChain.id })}
                className="self-start rounded-lg border border-negative/50 px-3.5 py-2 text-sm text-negative transition-colors hover:border-negative"
              >
                Switch to {activeChain.name}
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="USDT0 balance" value={fmt(walletBal)} />
                <Field label="Your position" value={`$${fmt(position)}`} />
              </div>
            )}

            <button
              onClick={() => disconnect()}
              className="self-start rounded-lg border border-border px-3.5 py-2 text-sm text-negative transition-colors hover:border-negative/50 hover:bg-negative/10"
            >
              Disconnect
            </button>
          </div>
        )}
      </Panel>

      {/* Appearance */}
      <Panel className="p-5">
        <Label>Appearance</Label>
        <p className="mt-1 text-xs text-muted-foreground">Choose how Aumo looks. Saved on this device.</p>
        <div className="mt-4"><ThemeSelect /></div>
      </Panel>

      {/* Network & contracts */}
      <Panel className="p-5">
        <Label>Network &amp; contracts</Label>
        <dl className="mt-4 flex flex-col divide-y divide-border">
          <Row label="Network" value={`${activeChain.name}${isMainnet ? "" : " (testnet)"}`} />
          <Row
            label="Pool (ERC-4626)"
            value={short(POOL)}
            href={addrUrl(POOL)}
          />
          <Row label="Base asset" value="USDT0" href={addrUrl(USDT0)} />
        </dl>
      </Panel>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card-2 px-3.5 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tnum text-lg font-medium text-foreground">{value}</span>
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent">
          {value} ↗
        </a>
      ) : (
        <dd className="text-foreground">{value}</dd>
      )}
    </div>
  );
}

function ThemeSelect() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme((document.documentElement.getAttribute("data-theme") as "dark" | "light") || "dark");
  }, []);
  const set = (t: "dark" | "light") => {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("aumo-theme", t);
    } catch {}
    window.dispatchEvent(new Event("themechange"));
  };
  return (
    <div className="inline-flex rounded-lg border border-border p-1">
      {(["dark", "light"] as const).map((t) => (
        <button
          key={t}
          onClick={() => set(t)}
          className={`rounded-md px-4 py-1.5 text-sm capitalize transition-colors ${
            theme === t ? "bg-card-2 text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
