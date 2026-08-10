"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useDisconnect, useReadContracts, useSwitchChain, useWalletClient } from "wagmi";
import { toast } from "sonner";
import { POOL, USDT0, poolAbi, erc20Abi, activeChain, isMainnet } from "@/lib/chain";
import { addrUrl, short } from "@/lib/agent";
import { Panel, Label } from "@/components/ui";
import { ConnectButton } from "@/components/wallet";

const DEC = 6;
const fmt = (v: bigint | undefined) =>
  v === undefined ? "-" : (Number(v) / 10 ** DEC).toLocaleString("en-US", { maximumFractionDigits: 2 });

const MARKETING = "https://aumo.finance";
const resources: [string, string][] = [
  [`${MARKETING}/docs`, "Docs"],
  [`${MARKETING}/whitepaper`, "Whitepaper"],
  [`${MARKETING}/terms`, "Terms"],
  [`${MARKETING}/privacy`, "Privacy"],
  ["https://x.com/aumofinance", "Aumo on X"],
  ["mailto:info@aumo.finance", "info@aumo.finance"],
];

export default function SettingsPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
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

  const addToken = async () => {
    if (!walletClient) return;
    try {
      await walletClient.watchAsset({ type: "ERC20", options: { address: USDT0, symbol: "USDT0", decimals: 6 } });
    } catch {
      toast.error("Couldn't add the token");
    }
  };

  const addNetwork = async () => {
    if (!walletClient) return;
    try {
      await walletClient.addChain({ chain: activeChain });
      toast.success(`${activeChain.name} added`);
    } catch {
      toast.error("Couldn't add the network");
    }
  };

  const chipBtn =
    "rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:border-foreground/40 disabled:opacity-40";

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
                <button onClick={copy} className={chipBtn}>Copy</button>
                <a href={addrUrl(address)} target="_blank" rel="noreferrer" className={chipBtn}>Explorer</a>
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
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card-2 px-3.5 py-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/usdt0.jpg" alt="" className="size-8 shrink-0 rounded-full" />
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">USDT0 balance</span>
                    <span className="tnum text-base font-medium text-foreground">{fmt(walletBal)}</span>
                  </div>
                </div>
                <Field label="Your position" value={`$${fmt(position)}`} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={addToken} disabled={!walletClient} className={chipBtn}>Add USDT0 to wallet</button>
              <button onClick={addNetwork} disabled={!walletClient} className={chipBtn}>Add {activeChain.name}</button>
              <button
                onClick={() => disconnect()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-negative transition-colors hover:border-negative/50 hover:bg-negative/10"
              >
                Disconnect
              </button>
            </div>
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
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-card-2 px-3.5 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/xlayer.jpg" alt="" className="size-8 shrink-0 rounded-lg" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{activeChain.name}</span>
            <span className="text-xs text-muted-foreground">Chain ID {activeChain.id}{isMainnet ? "" : " · testnet"}</span>
          </div>
        </div>
        <dl className="mt-2 flex flex-col divide-y divide-border">
          <Row label="Pool (ERC-4626)" value={short(POOL)} href={addrUrl(POOL)} />
          <Row label="Base asset" value="USDT0" href={addrUrl(USDT0)} />
        </dl>
      </Panel>

      {/* Resources */}
      <Panel className="p-5">
        <Label>Resources</Label>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {resources.map(([href, label]) => (
            <a
              key={href}
              href={href}
              target={href.startsWith("mailto:") ? undefined : "_blank"}
              rel="noreferrer"
              className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5 text-sm text-foreground transition-colors hover:border-foreground/40"
            >
              {label}
              <span className="text-faint">↗</span>
            </a>
          ))}
        </div>
      </Panel>

      {/* About */}
      <Panel className="p-5">
        <Label>About</Label>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Aumo is an autonomous treasury agent for stablecoins. It moves idle USDT0 into the best
          risk-adjusted yield across on-chain lending and real-world-asset-backed dollars, inside
          on-chain guardrails, and proves every move.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/xlayer.jpg" alt="" className="size-4 rounded" />
          Built on X Layer
        </div>
      </Panel>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card-2 px-3.5 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tnum text-base font-medium text-foreground">{value}</span>
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
