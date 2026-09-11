"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits, parseAbi } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { toast } from "sonner";
import {
  STOCKS,
  liveStocks,
  type StockConfig,
  USDT0,
  erc20Abi,
  equityPoolAbi,
  equityOracleAbi,
  activeChain,
  isMainnet,
} from "@/lib/chain";
import { Panel, Label, Badge, Dot } from "@/components/ui";
import { ConnectButton } from "@/components/wallet";
import { Num } from "@/components/num";
import { Orb } from "@/components/orb";
import { txUrl } from "@/lib/agent";

const DEC = 6;
const num = (v: bigint | undefined) => (v === undefined ? 0 : Number(v) / 10 ** DEC);
const fmt = (v: bigint | undefined, max = 2) =>
  v === undefined ? "-" : (Number(v) / 10 ** DEC).toLocaleString("en-US", { maximumFractionDigits: max });
const usd = (p: number | undefined) => (p === undefined ? "-" : `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

const FAUCET_ABI = parseAbi(["function mint(address to, uint256 amount)"]);
const primaryBtn =
  "chamfer inline-flex w-full items-center justify-center bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function StocksPage() {
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

  const [selected, setSelected] = useState<StockConfig | null>(liveStocks[0] ?? null);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [ack, setAck] = useState(false);

  // Per-live-stock price + market status for the catalog cards, batched in one multicall.
  const catalogReads = useReadContracts({
    contracts: liveStocks.flatMap((s) => [
      { address: s.oracle, abi: equityOracleAbi, functionName: "priceWad", args: [s.feedId] } as const,
      { address: s.pool, abi: equityPoolAbi, functionName: "marketOpen" } as const,
    ]),
    chainId: activeChain.id,
    query: { enabled: liveStocks.length > 0, refetchInterval: 12_000 },
  });
  const priceOf = (i: number) => {
    const r = catalogReads.data?.[i * 2]?.result as [bigint, bigint] | undefined;
    return r ? Number(r[0]) / 1e18 : undefined;
  };
  const openOf = (i: number) => catalogReads.data?.[i * 2 + 1]?.result as boolean | undefined;
  const selIdx = selected ? liveStocks.findIndex((s) => s.pool === selected.pool) : -1;
  const price = selIdx >= 0 ? priceOf(selIdx) : undefined;
  const marketOpen = selIdx >= 0 ? openOf(selIdx) : undefined;
  const marketClosed = marketOpen === false;

  // Selected stock's pool + wallet reads.
  const navRead = useReadContract({
    address: selected?.pool,
    abi: equityPoolAbi,
    functionName: "totalAssets",
    chainId: activeChain.id,
    query: { enabled: Boolean(selected), refetchInterval: 12_000 },
  });
  const nav = navRead.data as bigint | undefined;

  const reads = useReadContracts({
    contracts: [
      { address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [address!] },
      { address: USDT0, abi: erc20Abi, functionName: "allowance", args: [address!, selected?.pool as `0x${string}`] },
      { address: selected?.pool, abi: equityPoolAbi, functionName: "maxWithdraw", args: [address!] },
    ],
    chainId: activeChain.id,
    query: { enabled: Boolean(address) && !wrongChain && Boolean(selected), refetchInterval: 12_000 },
  });
  const walletBal = reads.data?.[0]?.result as bigint | undefined;
  const allowance = reads.data?.[1]?.result as bigint | undefined;
  const position = reads.data?.[2]?.result as bigint | undefined;

  const { writeContract, data: hash, isPending, reset, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const pending = useRef<{ action: "approve" | "deposit" | "withdraw"; amountWei: bigint } | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelReset = () => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  };

  function doDeposit(amt: bigint) {
    if (!selected) return;
    cancelReset();
    pending.current = { action: "deposit", amountWei: amt };
    writeContract({ address: selected.pool, abi: equityPoolAbi, functionName: "deposit", args: [amt, address!], chainId: activeChain.id });
  }

  const { writeContract: writeFaucet, data: faucetHash, isPending: faucetPending } = useWriteContract();
  const faucetReceipt = useWaitForTransactionReceipt({ hash: faucetHash });
  useEffect(() => {
    if (!faucetReceipt.isSuccess) return;
    if (faucetReceipt.data?.status === "success") {
      reads.refetch();
      toast.success("Minted 1,000 test USDT0 to your wallet");
    } else if (faucetReceipt.data?.status === "reverted") {
      toast.error("Faucet mint reverted on-chain");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faucetReceipt.isSuccess]);
  function faucet() {
    if (!address) return;
    writeFaucet({ address: USDT0, abi: FAUCET_ABI, functionName: "mint", args: [address, parseUnits("1000", DEC)], chainId: activeChain.id });
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
    navRead.refetch();
    catalogReads.refetch();
    setAmount("");
    pending.current = null;
    toast.success(p?.action === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed", {
      action: hash ? { label: "View", onClick: () => window.open(txUrl(hash), "_blank") } : undefined,
    });
    cancelReset();
    resetTimer.current = setTimeout(() => reset(), 4000);
    return () => cancelReset();
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
    if (!address || !selected || amountWei <= 0n) return;
    cancelReset();
    if (tab === "deposit") {
      if (needsApproval) {
        pending.current = { action: "approve", amountWei };
        writeContract({ address: USDT0, abi: erc20Abi, functionName: "approve", args: [selected.pool, amountWei], chainId: activeChain.id });
      } else {
        doDeposit(amountWei);
      }
    } else {
      pending.current = { action: "withdraw", amountWei };
      writeContract({ address: selected.pool, abi: equityPoolAbi, functionName: "withdraw", args: [amountWei, address, address], chainId: activeChain.id });
    }
  }

  const label = !isConnected
    ? "Connect wallet"
    : wrongChain
      ? switching ? "Switching…" : `Switch to ${activeChain.name}`
      : marketClosed
        ? "Market closed"
        : amountWei <= 0n
          ? "Enter an amount"
          : overMax
            ? "Insufficient balance"
            : depositBlocked
              ? "Acknowledge the risk to continue"
              : busy
                ? "Confirming…"
                : tab === "deposit"
                  ? needsApproval ? "Approve USDT0" : "Deposit"
                  : "Withdraw";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-medium tracking-tight">Stocks</h1>
          <Badge tone="negative">At-risk</Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          Opt-in, directional exposure to tokenized stocks, priced by Chainlink Data Streams. Each
          stock is its own pool. Not capital preservation — your deposit&apos;s value moves with the
          stock, and trading freezes when the market is closed.
        </span>
      </header>

      <div className="rounded-lg border border-negative/40 bg-negative/5 px-4 py-3 text-sm leading-relaxed text-negative">
        These pools hold tokenized stocks and <span className="font-medium">can lose value</span>. They
        are separate from the safe USDT0 pool and not covered by its guardrails against loss. You bear
        the full price risk of the stock you choose. Only deposit what you can afford to see fall.
      </div>

      {/* Catalog */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Choose a stock</Label>
          <span className="text-xs text-faint">
            More listed as Chainlink feeds and X Layer liquidity come online.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {STOCKS.map((s) => {
            const live = liveStocks.some((l) => l.pool === s.pool);
            const idx = liveStocks.findIndex((l) => l.pool === s.pool);
            const isSel = selected?.pool === s.pool && live;
            const open = live ? openOf(idx) : undefined;
            return (
              <button
                key={s.symbol}
                type="button"
                disabled={!live}
                onClick={() => { if (live) { setSelected(s); setAmount(""); setAck(false); reset(); } }}
                className={`chamfer group flex flex-col gap-3 border p-4 text-left transition-[transform,border-color,background-color] ${
                  isSel
                    ? "border-primary/70 bg-card-2 ring-1 ring-primary/30"
                    : live
                      ? "cursor-pointer border-border bg-card hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card-2"
                      : "cursor-default border-border/70 bg-card"
                }`}
                style={{ ["--cut" as string]: "12px" }}
              >
                <div className="flex items-start justify-between">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/brand/stocks/${s.symbol.replace(/x$/, "")}.png`}
                    alt={s.name}
                    className={`size-11 rounded-xl border border-border/50 object-cover shadow-sm ${live ? "" : "opacity-90"}`}
                  />
                  {live ? (
                    open === false ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card-2 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"><Dot tone="muted" /> Closed</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive"><Dot tone="positive" /> Live</span>
                    )
                  ) : (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">Soon</span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold tracking-tight text-foreground">{s.symbol}</span>
                  <span className="truncate text-xs text-muted-foreground">{s.name}</span>
                </div>
                <span className="tnum mt-auto text-base font-medium text-foreground">
                  {live ? usd(priceOf(idx)) : <span className="text-sm text-faint">Coming soon</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Position + stock */}
          <div className="flex flex-col gap-6">
            <Panel className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/brand/stocks/${selected.symbol.replace(/x$/, "")}.png`}
                    alt={selected.name}
                    className="mt-0.5 size-10 rounded-xl border border-border/50 shadow-sm"
                  />
                  <div>
                    <Label>Your position · {selected.symbol}</Label>
                    <div className="mt-1.5 text-3xl font-medium text-foreground">
                      <Num value={num(position)} currency />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {marketClosed ? "Redeemable when the market reopens" : "USDT0 redeemable at the current price"}
                    </div>
                  </div>
                </div>
                {marketOpen === undefined ? null : marketOpen ? (
                  <Badge tone="positive"><Dot tone="positive" /> Open</Badge>
                ) : (
                  <Badge tone="neutral"><Dot tone="muted" /> Closed</Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                <div className="flex flex-col gap-1">
                  <Label>{selected.symbol} price</Label>
                  <span className="tnum text-sm font-medium text-foreground">{usd(price)}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Pool NAV</Label>
                  <span className="text-sm font-medium text-foreground"><Num value={num(nav)} currency maximumFractionDigits={0} /></span>
                </div>
              </div>
            </Panel>

            <Panel className="p-5">
              <Label>Wallet balance</Label>
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-card-2 px-3.5 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/usdt0.jpg" alt="" className="size-9 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">USDT0</span>
                  <span className="text-xs text-muted-foreground">USD₮0 on {activeChain.name}</span>
                </div>
                <span className="tnum ml-auto text-lg font-medium text-foreground"><Num value={num(walletBal)} /></span>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                You deposit USDT0; the agent converts it to {selected.symbol} exposure and back. When you
                withdraw, the stock is sold and you receive USDT0 — more or less than you put in, depending
                on where {selected.symbol} has moved.
              </p>
              {!isMainnet && isConnected ? (
                <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-card-2 px-3.5 py-3">
                  <span className="text-xs text-muted-foreground">
                    {wrongChain ? `Switch to ${activeChain.name} to mint test USDT0.` : "Testnet: grab test USDT0 to try it. Not real money."}
                  </span>
                  <button
                    type="button"
                    onClick={wrongChain ? () => switchChain({ chainId: activeChain.id }) : faucet}
                    disabled={faucetPending || faucetReceipt.isLoading || switching}
                    className="chamfer inline-flex items-center justify-center gap-2 self-start bg-surface-2 px-3.5 py-2 text-xs font-medium text-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ ["--cut" as string]: "8px" }}
                  >
                    {faucetPending || faucetReceipt.isLoading ? (<><Orb className="size-3.5 text-accent" /> Minting…</>) : "Get 1,000 test USDT0"}
                  </button>
                </div>
              ) : null}
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

            {marketClosed ? (
              <div className="mb-4 rounded-lg border border-border bg-card-2 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                <span className="text-foreground">{selected.symbol} is closed.</span> Deposits and
                withdrawals both pause until the market reopens — a stock position can&apos;t be fairly
                priced or sold while it&apos;s shut. Your position stays valued at the last price.
              </div>
            ) : null}

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
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/usdt0.jpg" alt="" className="size-4 rounded-full" /> USDT0
                </span>
              </div>
            </div>

            {tab === "deposit" && !marketClosed ? (
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
                <span>I understand this pool holds directional {selected.symbol} exposure, is not capital preservation, and can lose value.</span>
              </label>
            ) : null}

            <div className="mt-5">
              {!isConnected ? (
                <ConnectButton />
              ) : (
                <button
                  className={primaryBtn}
                  disabled={wrongChain ? switching : busy || marketClosed || amountWei <= 0n || overMax || depositBlocked}
                  onClick={submit}
                >
                  {label}
                </button>
              )}
            </div>

            {hash ? (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card-2 px-3 py-2 text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  {receipt.isLoading ? <Orb className="size-3.5 text-accent" /> : null}
                  {receipt.isLoading ? "Confirming…" : receipt.isSuccess ? "Confirmed" : "Submitted"}
                </span>
                <a className="text-accent hover:underline" href={txUrl(hash)} target="_blank" rel="noreferrer">view ↗</a>
              </div>
            ) : null}

            {error ? <p className="mt-3 text-xs text-negative">{error.message.split("\n")[0].slice(0, 120)}</p> : null}
          </Panel>
        </div>
      ) : (
        // No stock live on this network yet (mainnet pre-launch).
        <Panel className="flex flex-col gap-4 p-6">
          <p className="text-sm leading-relaxed text-foreground">
            Tokenized-stock pools launch on X Layer once the mainnet oracle is wired. Each stock above
            will be its own opt-in pool: deposit USDT0, the agent buys the tokenized stock within hard
            on-chain caps, and you carry the price exposure you chose.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Priced by Chainlink Data Streams, they trade only while the market is open and freeze
            otherwise. The catalog runs live on testnet today.
          </p>
        </Panel>
      )}
    </div>
  );
}
