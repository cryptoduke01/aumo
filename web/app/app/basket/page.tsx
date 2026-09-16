"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseUnits } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useSimulateContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { toast } from "sonner";
import { BASKET, USDT0, erc20Abi, equityPoolAbi, activeChain } from "@/lib/chain";
import { Panel, Label, Dot } from "@/components/ui";
import { ConnectButton } from "@/components/wallet";
import { Num } from "@/components/num";
import { txUrl } from "@/lib/agent";

const DEC = 6;
const num = (v: bigint | undefined) => (v === undefined ? 0 : Number(v) / 10 ** DEC);
const fmt = (v: bigint | undefined, max = 2) =>
  v === undefined ? "-" : (Number(v) / 10 ** DEC).toLocaleString("en-US", { maximumFractionDigits: max });

const primaryBtn =
  "chamfer inline-flex w-full items-center justify-center bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function BasketPage() {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongChain = isConnected && walletChainId !== undefined && walletChainId !== activeChain.id;

  const autoSwitched = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (isConnected && wrongChain && !switching && autoSwitched.current !== walletChainId) {
      autoSwitched.current = walletChainId;
      switchChain({ chainId: activeChain.id });
    }
  }, [isConnected, wrongChain, walletChainId, switching, switchChain]);

  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [ack, setAck] = useState(false);

  if (!BASKET) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <Panel className="p-10">
          <p className="text-sm text-muted-foreground">The diversified basket is not live on this network yet.</p>
        </Panel>
      </div>
    );
  }
  const basket = BASKET;

  // Pool-level: NAV + market status.
  const poolReads = useReadContracts({
    contracts: [
      { address: basket.pool, abi: equityPoolAbi, functionName: "totalAssets" } as const,
      { address: basket.pool, abi: equityPoolAbi, functionName: "marketOpen" } as const,
    ],
    chainId: activeChain.id,
    query: { refetchInterval: 12_000 },
  });
  const nav = poolReads.data?.[0]?.result as bigint | undefined;
  const marketOpen = poolReads.data?.[1]?.result as boolean | undefined;
  const marketClosed = marketOpen === false;

  // Per-member weights via venueBalance (homogeneous multicall).
  const weightReads = useReadContracts({
    contracts: basket.members.map((m) => ({
      address: basket.pool,
      abi: equityPoolAbi,
      functionName: "venueBalance" as const,
      args: [m.venue],
    })),
    chainId: activeChain.id,
    query: { refetchInterval: 12_000 },
  });
  const weightOf = (i: number) => weightReads.data?.[i]?.result as bigint | undefined;

  // Wallet + position.
  const reads = useReadContracts({
    contracts: [
      { address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [address!] },
      { address: USDT0, abi: erc20Abi, functionName: "allowance", args: [address!, basket.pool] },
      { address: basket.pool, abi: equityPoolAbi, functionName: "maxWithdraw", args: [address!] },
      { address: basket.pool, abi: equityPoolAbi, functionName: "maxRedeem", args: [address!] },
    ],
    chainId: activeChain.id,
    query: { enabled: Boolean(address) && !wrongChain, refetchInterval: 12_000 },
  });
  const walletBal = reads.data?.[0]?.result as bigint | undefined;
  const allowance = reads.data?.[1]?.result as bigint | undefined;
  const position = reads.data?.[2]?.result as bigint | undefined;
  const shares = reads.data?.[3]?.result as bigint | undefined;

  const { writeContract, data: hash, isPending, reset, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const pending = useRef<{ action: "approve" | "deposit" | "withdraw"; amountWei: bigint; est?: bigint } | null>(null);

  function doDeposit(amt: bigint) {
    pending.current = { action: "deposit", amountWei: amt };
    writeContract({ address: basket.pool, abi: equityPoolAbi, functionName: "deposit", args: [amt, address!], chainId: activeChain.id });
  }

  useEffect(() => {
    if (!receipt.isSuccess) return;
    if (receipt.data?.status !== "success") {
      if (receipt.data?.status === "reverted") {
        pending.current = null;
        reads.refetch();
        toast.error("Transaction reverted on-chain. No funds moved.");
        reset();
      }
      return;
    }
    const p = pending.current;
    reads.refetch();
    if (p?.action === "approve") {
      toast.success("Approved — confirming your deposit…");
      const amt = p.amountWei;
      reset();
      setTimeout(() => doDeposit(amt), 0);
      return;
    }
    poolReads.refetch();
    setAmount("");
    pending.current = null;
    const msg =
      p?.action === "deposit"
        ? "Deposit confirmed"
        : p?.est !== undefined
          ? `Withdrawal confirmed — you received ≈ ${fmt(p.est)} USDT0`
          : "Withdrawal confirmed";
    toast.success(msg, { action: hash ? { label: "View", onClick: () => window.open(txUrl(hash), "_blank") } : undefined });
  }, [receipt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hash) toast("Transaction submitted", { description: "Waiting for confirmation…" });
  }, [hash]);
  useEffect(() => {
    if (error) {
      pending.current = null;
      toast.error(error.message.split("\n")[0].slice(0, 120));
    }
  }, [error]);

  const amountWei = useMemo(() => {
    try {
      return amount ? parseUnits(amount, DEC) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  // Realizable-value withdraw: redeem the shares matching the requested amount (all shares on a full exit).
  const sharesToRedeem = useMemo(() => {
    if (tab !== "withdraw" || !shares || !position || position === 0n || amountWei <= 0n) return 0n;
    return amountWei >= position ? shares : (shares * amountWei) / position;
  }, [tab, shares, position, amountWei]);

  const withdrawSim = useSimulateContract({
    address: basket.pool,
    abi: equityPoolAbi,
    functionName: "redeem",
    args: [sharesToRedeem, address as `0x${string}`, address as `0x${string}`],
    chainId: activeChain.id,
    query: { enabled: tab === "withdraw" && Boolean(address) && !wrongChain && sharesToRedeem > 0n && marketOpen === true },
  });
  const estOut = withdrawSim.data?.result as bigint | undefined;

  const max = tab === "deposit" ? walletBal : position;
  const overMax = max !== undefined && amountWei > max;
  const needsApproval = tab === "deposit" && (allowance ?? 0n) < amountWei;
  const busy = isPending || receipt.isLoading;
  const depositBlocked = tab === "deposit" && !ack;

  function submit() {
    if (wrongChain) {
      switchChain({ chainId: activeChain.id });
      return;
    }
    if (!address || amountWei <= 0n) return;
    if (tab === "deposit") {
      if (needsApproval) {
        pending.current = { action: "approve", amountWei };
        writeContract({ address: USDT0, abi: erc20Abi, functionName: "approve", args: [basket.pool, amountWei], chainId: activeChain.id });
      } else {
        doDeposit(amountWei);
      }
    } else {
      if (sharesToRedeem <= 0n) return;
      pending.current = { action: "withdraw", amountWei, est: estOut };
      writeContract({ address: basket.pool, abi: equityPoolAbi, functionName: "redeem", args: [sharesToRedeem, address!, address!], chainId: activeChain.id });
    }
  }

  const navN = num(nav);
  const cta = wrongChain
    ? "Switch to X Layer"
    : tab === "deposit"
      ? needsApproval
        ? "Approve USDT0"
        : "Deposit"
      : "Withdraw";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium tracking-tight">Diversified basket</h1>
        <span className="text-sm text-muted-foreground">
          One deposit, equal-weight exposure across {basket.members.length} stocks. The agent keeps the
          weights equal. Diversification cut max drawdown from about 43% on a single name to about 32%
          across the basket over the last 5 years, including the 2022 selloff. It is still at-risk
          equity, not capital preservation.
        </span>
      </header>

      {/* holdings */}
      <Panel className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <Label>Holdings</Label>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Dot tone={marketClosed ? "muted" : "positive"} />
            {marketClosed ? "Market closed" : "Market open"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {basket.members.map((m, i) => {
            const ticker = m.symbol.replace(/x$/, "");
            const w = weightOf(i);
            const pct = nav && nav > 0n && w !== undefined ? (Number(w) / Number(nav)) * 100 : undefined;
            return (
              <div key={m.venue} className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/stocks/${ticker}.png`} alt={m.name} width={28} height={28} className="size-7 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-semibold tracking-tight text-foreground">{ticker}</span>
                  <span className="tnum text-[11px] text-muted-foreground">
                    {pct === undefined ? "—" : `${pct.toFixed(0)}%`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Basket size</span>
          <span className="tnum text-foreground">
            <Num value={navN} currency maximumFractionDigits={2} />
          </span>
        </div>
      </Panel>

      {/* deposit / withdraw */}
      <Panel className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-1 self-start rounded-lg border border-border p-1">
          {(["deposit", "withdraw"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setAmount("");
              }}
              className={`rounded-md px-3 py-1 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === t ? "bg-card-2 text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {!isConnected ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">Connect a wallet to deposit into the basket.</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{tab === "deposit" ? "USDT0 to deposit" : "USDT0 to withdraw"}</span>
                <button
                  className="tnum hover:text-foreground"
                  onClick={() => setAmount(tab === "deposit" ? fmt(walletBal, 6) : fmt(position, 6))}
                >
                  {tab === "deposit" ? `Balance ${fmt(walletBal)}` : `Position ${fmt(position)}`}
                </button>
              </div>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-lg tnum text-foreground outline-none focus-visible:border-foreground/40"
              />
              {overMax ? <span className="text-xs text-negative">Amount exceeds your {tab === "deposit" ? "balance" : "position"}.</span> : null}
              {tab === "withdraw" && sharesToRedeem > 0n && estOut !== undefined ? (
                <span className="text-xs text-muted-foreground">You receive ≈ <span className="tnum text-foreground">{fmt(estOut)}</span> USDT0 at the current basket price.</span>
              ) : null}
            </div>

            {marketClosed ? (
              <p className="rounded-lg border border-border bg-card-2/40 p-3 text-xs text-muted-foreground">
                The US market is closed. Deposits and withdrawals reopen when it does, so no one enters or
                exits at a stale weekend price.
              </p>
            ) : null}

            {tab === "deposit" ? (
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                <span>I understand this basket holds directional stock exposure, is not capital preservation, and can lose value.</span>
              </label>
            ) : null}

            <button
              onClick={submit}
              disabled={busy || (tab === "deposit" && (amountWei <= 0n || overMax || depositBlocked || marketClosed)) || (tab === "withdraw" && (sharesToRedeem <= 0n || marketClosed))}
              className={primaryBtn}
            >
              {busy ? "Confirming…" : cta}
            </button>
          </>
        )}
      </Panel>
    </div>
  );
}
