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
  EQUITY_POOL,
  EQUITY_ORACLE,
  EQUITY_FEED_ID,
  EQUITY_SYMBOL,
  EQUITY_NAME,
  equityConfigured,
  equityPoolAbi,
  equityOracleAbi,
  USDT0,
  erc20Abi,
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

const FAUCET_ABI = parseAbi(["function mint(address to, uint256 amount)"]);

const primaryBtn =
  "chamfer inline-flex w-full items-center justify-center bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function EquityPage() {
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
  const [ack, setAck] = useState(false); // at-risk acknowledgement gates the first deposit

  // Public pool state — NAV, exposure, and whether the market is open, read even before connect.
  const poolReads = useReadContract({
    address: EQUITY_POOL,
    abi: equityPoolAbi,
    functionName: "totalAssets",
    chainId: activeChain.id,
    query: { enabled: equityConfigured, refetchInterval: 12_000 },
  });
  const nav = poolReads.data as bigint | undefined;

  const stateReads = useReadContracts({
    contracts: [
      { address: EQUITY_POOL, abi: equityPoolAbi, functionName: "idleBalance" },
      { address: EQUITY_POOL, abi: equityPoolAbi, functionName: "marketOpen" },
      { address: EQUITY_ORACLE, abi: equityOracleAbi, functionName: "priceWad", args: [EQUITY_FEED_ID] },
    ],
    chainId: activeChain.id,
    query: { enabled: equityConfigured, refetchInterval: 12_000 },
  });
  const idle = stateReads.data?.[0]?.result as bigint | undefined;
  const marketOpen = stateReads.data?.[1]?.result as boolean | undefined;
  const priceWad = (stateReads.data?.[2]?.result as [bigint, bigint] | undefined)?.[0];
  const price = priceWad !== undefined ? Number(priceWad) / 1e18 : undefined;
  const exposure = nav !== undefined && idle !== undefined ? nav - idle : undefined; // USD value in the stock

  const reads = useReadContracts({
    contracts: [
      { address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [address!] },
      { address: USDT0, abi: erc20Abi, functionName: "allowance", args: [address!, EQUITY_POOL] },
      { address: EQUITY_POOL, abi: equityPoolAbi, functionName: "maxWithdraw", args: [address!] },
    ],
    chainId: activeChain.id,
    query: { enabled: Boolean(address) && !wrongChain && equityConfigured, refetchInterval: 12_000 },
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
    cancelReset();
    pending.current = { action: "deposit", amountWei: amt };
    writeContract({ address: EQUITY_POOL, abi: equityPoolAbi, functionName: "deposit", args: [amt, address!], chainId: activeChain.id });
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
    poolReads.refetch();
    stateReads.refetch();
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
  const marketClosed = marketOpen === false;
  const depositBlocked = tab === "deposit" && !ack;

  function submit() {
    if (wrongChain) {
      switchChain({ chainId: activeChain.id });
      return;
    }
    if (!address || amountWei <= 0n) return;
    cancelReset();
    if (tab === "deposit") {
      if (needsApproval) {
        pending.current = { action: "approve", amountWei };
        writeContract({ address: USDT0, abi: erc20Abi, functionName: "approve", args: [EQUITY_POOL, amountWei], chainId: activeChain.id });
      } else {
        doDeposit(amountWei);
      }
    } else {
      pending.current = { action: "withdraw", amountWei };
      writeContract({ address: EQUITY_POOL, abi: equityPoolAbi, functionName: "withdraw", args: [amountWei, address, address], chainId: activeChain.id });
    }
  }

  const label = !isConnected
    ? "Connect wallet"
    : wrongChain
      ? switching
        ? "Switching…"
        : `Switch to ${activeChain.name}`
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
                  ? needsApproval
                    ? "Approve USDT0"
                    : "Deposit"
                  : "Withdraw";

  // Not deployed on this network yet (mainnet pre-launch): show what it is, honestly.
  if (!equityConfigured) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-2 border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-medium tracking-tight">Equity</h1>
            <Badge tone="neutral">At-risk · coming soon</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            An opt-in pool that holds directional exposure to a tokenized stock, chosen by you.
          </span>
        </header>
        <Panel className="flex flex-col gap-4 p-6">
          <p className="text-sm leading-relaxed text-foreground">
            Aumo&apos;s equity pool is separate from the safe treasury pool. You deposit USDT0 and the
            agent buys a tokenized stock ({EQUITY_SYMBOL}) within hard on-chain caps, so the pool holds
            the price exposure you chose. It is <span className="text-foreground">not</span> capital
            preservation: the value moves with the stock, and you carry that risk.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Priced by Chainlink Data Streams, it trades only while the market is open and freezes
            otherwise. It goes live on X Layer once the mainnet oracle is wired. Until then it runs on
            testnet.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-medium tracking-tight">Equity</h1>
          <Badge tone="negative">At-risk</Badge>
          <span className="ml-auto">
            {marketOpen === undefined ? null : marketOpen ? (
              <Badge tone="positive"><Dot tone="positive" /> Market open</Badge>
            ) : (
              <Badge tone="neutral"><Dot tone="muted" /> Market closed</Badge>
            )}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Directional exposure to {EQUITY_NAME} ({EQUITY_SYMBOL}), chosen by you. Not capital
          preservation — your deposit&apos;s value moves with the stock.
        </span>
      </header>

      {/* Unmissable risk statement. */}
      <div className="rounded-lg border border-negative/40 bg-negative/5 px-4 py-3 text-sm leading-relaxed text-negative">
        This pool holds a tokenized stock and <span className="font-medium">can lose value</span>. It is
        separate from the safe USDT0 pool and is not covered by its guardrails against loss. You bear the
        full price risk of {EQUITY_SYMBOL}. Only deposit what you can afford to see fall.
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Panel className="flex flex-col gap-4 p-5">
            <div>
              <Label>Your position</Label>
              <div className="mt-1.5 text-3xl font-medium text-foreground">
                <Num value={num(position)} currency />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {marketClosed
                  ? "Redeemable when the market reopens"
                  : "USDT0 redeemable at the current price"}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 border-t border-border pt-4">
              <div className="flex flex-col gap-1">
                <Label>{EQUITY_SYMBOL} price</Label>
                <span className="tnum text-sm font-medium text-foreground">
                  {price !== undefined ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "-"}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Pool NAV</Label>
                <span className="text-sm font-medium text-foreground"><Num value={num(nav)} currency maximumFractionDigits={0} /></span>
              </div>
              <div className="flex flex-col gap-1">
                <Label>In {EQUITY_SYMBOL}</Label>
                <span className="text-sm font-medium text-foreground"><Num value={num(exposure)} currency maximumFractionDigits={0} /></span>
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
              You deposit USDT0; the agent converts it to {EQUITY_SYMBOL} exposure and back. When you
              withdraw, the stock is sold and you receive USDT0 — more or less than you put in, depending
              on where {EQUITY_SYMBOL} has moved.
            </p>
            {!isMainnet && isConnected ? (
              <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-card-2 px-3.5 py-3">
                <span className="text-xs text-muted-foreground">
                  {wrongChain
                    ? `Switch to ${activeChain.name} to mint test USDT0. Costs a little testnet OKB — no real money.`
                    : "Testnet: grab test USDT0 to try it. Not real money."}
                </span>
                <button
                  type="button"
                  onClick={wrongChain ? () => switchChain({ chainId: activeChain.id }) : faucet}
                  disabled={faucetPending || faucetReceipt.isLoading || switching}
                  className="chamfer inline-flex items-center justify-center gap-2 self-start bg-surface-2 px-3.5 py-2 text-xs font-medium text-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ ["--cut" as string]: "8px" }}
                >
                  {faucetPending || faucetReceipt.isLoading ? (
                    <>
                      <Orb className="size-3.5 text-accent" /> Minting…
                    </>
                  ) : (
                    "Get 1,000 test USDT0"
                  )}
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
              <span className="text-foreground">The market is closed.</span> Deposits and withdrawals
              both pause until it reopens — a stock position can&apos;t be fairly priced or sold while the
              market is shut. Your position stays valued at the last price in the meantime.
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
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span>
                I understand this pool holds directional {EQUITY_SYMBOL} exposure, is not capital
                preservation, and can lose value.
              </span>
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

          {needsApproval && !busy && !marketClosed && amountWei > 0n && !overMax && ack ? (
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
            <p className="mt-3 text-xs text-negative">{error.message.split("\n")[0].slice(0, 120)}</p>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
