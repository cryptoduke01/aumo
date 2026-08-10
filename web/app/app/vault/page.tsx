"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, maxUint256 } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { toast } from "sonner";
import { POOL, USDT0, poolAbi, erc20Abi, activeChain, poolConfigured } from "@/lib/chain";
import { Panel, Label, Badge } from "@/components/ui";
import { ConnectButton } from "@/components/wallet";
import { BridgeIn } from "@/components/bridge-in";
import { Num } from "@/components/num";
import { Orb } from "@/components/orb";
import { txUrl, getReceipts, pct } from "@/lib/agent";

const DEC = 6;
const fmt = (v: bigint | undefined, max = 2) =>
  v === undefined ? "-" : (Number(v) / 10 ** DEC).toLocaleString("en-US", { maximumFractionDigits: max });
const num = (v: bigint | undefined) => (v === undefined ? 0 : Number(v) / 10 ** DEC);

const primaryBtn =
  "chamfer inline-flex w-full items-center justify-center bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function VaultPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wrongChain = isConnected && chainId !== activeChain.id;

  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");

  // Pool TVL is public, always read it, even before a wallet connects.
  const tvlRead = useReadContract({
    address: POOL,
    abi: poolAbi,
    functionName: "totalAssets",
    query: { refetchInterval: 12_000 },
  });
  const tvl = tvlRead.data as bigint | undefined;

  const reads = useReadContracts({
    contracts: [
      { address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [address!] },
      { address: USDT0, abi: erc20Abi, functionName: "allowance", args: [address!, POOL] },
      { address: POOL, abi: poolAbi, functionName: "maxWithdraw", args: [address!] },
    ],
    query: { enabled: Boolean(address) && !wrongChain, refetchInterval: 12_000 },
  });

  const walletBal = reads.data?.[0]?.result as bigint | undefined;
  const allowance = reads.data?.[1]?.result as bigint | undefined;
  const position = reads.data?.[2]?.result as bigint | undefined; // your redeemable USDT0

  // Tie the engine's live yield to the position: estimated annual earnings.
  const [bestApyBps, setBestApyBps] = useState<number | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getReceipts(1, ctrl.signal)
      .then((r) => {
        const risks = r[0]?.plan.risks ?? [];
        if (risks.length) setBestApyBps(Math.max(...risks.map((x) => x.riskAdjustedApyBps)));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const { writeContract, data: hash, isPending, reset, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  // Refresh balances and clear the form once a transaction confirms.
  useEffect(() => {
    if (receipt.isSuccess) {
      reads.refetch();
      tvlRead.refetch();
      setAmount("");
      toast.success("Transaction confirmed", {
        action: hash
          ? { label: "View", onClick: () => window.open(txUrl(hash), "_blank") }
          : undefined,
      });
      const t = setTimeout(() => reset(), 4000);
      return () => clearTimeout(t);
    }
  }, [receipt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toast when a tx is submitted to the network.
  useEffect(() => {
    if (hash) toast("Transaction submitted", { description: "Waiting for confirmation…" });
  }, [hash]);

  // Toast on write errors (rejected, reverted, etc.).
  useEffect(() => {
    if (error) toast.error(error.message.split("\n")[0].slice(0, 120));
  }, [error]);

  const amountWei = useMemo(() => {
    try {
      return amount ? parseUnits(amount, DEC) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  const max = tab === "deposit" ? walletBal : position;
  const overMax = max !== undefined && amountWei > max;
  const needsApproval = tab === "deposit" && (allowance ?? 0n) < amountWei;
  const busy = isPending || receipt.isLoading;

  function submit() {
    if (!address || amountWei <= 0n) return;
    if (tab === "deposit") {
      if (needsApproval) {
        writeContract({ address: USDT0, abi: erc20Abi, functionName: "approve", args: [POOL, maxUint256] });
      } else {
        writeContract({ address: POOL, abi: poolAbi, functionName: "deposit", args: [amountWei, address] });
      }
    } else {
      writeContract({ address: POOL, abi: poolAbi, functionName: "withdraw", args: [amountWei, address, address] });
    }
  }

  const label = !isConnected
    ? "Connect wallet"
    : wrongChain
      ? "Wrong network"
      : amountWei <= 0n
        ? "Enter an amount"
        : overMax
          ? "Insufficient balance"
          : busy
            ? "Confirming…"
            : tab === "deposit"
              ? needsApproval
                ? "Approve USDT0"
                : "Deposit"
              : "Withdraw";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1 border-b border-border pb-6">
        <h1 className="text-xl font-medium tracking-tight">Deposit</h1>
        <span className="text-xs text-muted-foreground">
          Deposit USDT0 into the pool for shares. The agent puts the pooled balance to work; yield
          accrues to every depositor.
        </span>
      </header>

      {!poolConfigured ? (
        <div className="rounded-lg border border-negative/40 bg-negative/5 px-4 py-3 text-sm text-negative">
          The pool address isn&apos;t configured for this network yet. Deposits and balances are
          unavailable until it&apos;s set.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Position + pool */}
        <div className="flex flex-col gap-6">
          <Panel className="flex flex-col gap-4 p-5">
            <div>
              <Label>Your position</Label>
              <div className="mt-1.5 text-3xl font-medium text-foreground">
                <Num value={num(position)} currency />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {position && tvl && tvl > 0n
                  ? `${((Number(position) / Number(tvl)) * 100).toFixed(2)}% of the pool`
                  : "USDT0 redeemable"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
              <div className="flex flex-col gap-1">
                <Label>Pool TVL</Label>
                <span className="text-sm font-medium text-foreground"><Num value={num(tvl)} currency maximumFractionDigits={0} /></span>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Est. annual yield</Label>
                <span className="text-sm font-medium text-accent">
                  {bestApyBps !== null ? (
                    <>
                      <Num value={(num(position) * bestApyBps) / 10000} currency /> · {pct(bestApyBps)}
                    </>
                  ) : (
                    "-"
                  )}
                </span>
              </div>
            </div>
          </Panel>
          <Panel className="p-5">
            <Label>Wallet</Label>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">USDT0 balance</span>
              <span className="tnum text-sm"><Num value={num(walletBal)} /></span>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              You&apos;ll need some USDT0 to deposit and a little OKB for gas.{" "}
              <span className="text-foreground">Withdraw anytime.</span> Your deposit is always
              yours, redeemable for your share of the pool plus any yield it earned.
            </p>
          </Panel>
        </div>

        {/* Action */}
        <Panel className="flex flex-col p-5">
          <div className="mb-5 flex rounded-lg border border-border p-1">
            {(["deposit", "withdraw"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setAmount(""); reset(); }}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  tab === t ? "bg-card-2 text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Amount</Label>
              <button
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                disabled={max === undefined}
                onClick={() => max !== undefined && setAmount(formatUnits(max, DEC))}
              >
                Max {fmt(max)}
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card-2 px-4 py-2.5 transition-colors focus-within:border-primary/50">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="field-input tnum w-full min-w-0 bg-transparent text-xl font-medium outline-none placeholder:text-faint"
                aria-label={`${tab} amount in USDT0`}
              />
              <span className="shrink-0 text-xs font-medium text-muted-foreground">USDT0</span>
            </div>
          </div>

          <div className="mt-5">
            {!isConnected ? (
              <ConnectButton />
            ) : (
              <button className={primaryBtn} disabled={busy || wrongChain || amountWei <= 0n || overMax} onClick={submit}>
                {label}
              </button>
            )}
          </div>

          {needsApproval && !busy && amountWei > 0n && !overMax ? (
            <p className="mt-3 text-xs text-muted-foreground">
              One-time approval so the pool can pull your USDT0, then deposit.
            </p>
          ) : null}

          {hash ? (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card-2 px-3 py-2 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                {receipt.isLoading ? <Orb className="size-3.5 text-accent" /> : null}
                {receipt.isLoading ? "Confirming…" : receipt.isSuccess ? "Confirmed" : "Submitted"}
              </span>
              <a className="text-accent hover:underline" href={txUrl(hash)} target="_blank" rel="noreferrer">
                view ↗
              </a>
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 text-xs text-negative">
              {error.message.split("\n")[0].slice(0, 120)}
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="max-w-md">
        <BridgeIn />
      </div>
    </div>
  );
}
