"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
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
import { GOLD, USDT0, erc20Abi, equityPoolAbi, equityOracleAbi, activeChain } from "@/lib/chain";
import { Panel, Label, Badge, Dot } from "@/components/ui";
import { ConnectButton } from "@/components/wallet";
import { Num } from "@/components/num";
import { Orb } from "@/components/orb";
import { txUrl } from "@/lib/agent";

const DEC = 6;
const num = (v: bigint | undefined) => (v === undefined ? 0 : Number(v) / 10 ** DEC);
const fmt = (v: bigint | undefined, max = 2) =>
  v === undefined ? "-" : (Number(v) / 10 ** DEC).toLocaleString("en-US", { maximumFractionDigits: max });
const usd = (p: number | undefined) =>
  p === undefined ? "-" : `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const primaryBtn =
  "chamfer inline-flex w-full items-center justify-center bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// The PAX Gold coin, rendered in CSS so there's no image dependency to ship.
function GoldCoin({ size = 44 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#caa23a]/40 font-semibold text-[#3a2c05] shadow-sm"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: "radial-gradient(circle at 32% 28%, #ffe9a8, #ffbc3e 46%, #b8860b)",
      }}
    >
      Au
    </span>
  );
}

export default function GoldPage() {
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

  const live = Boolean(GOLD);
  const poolAddr = GOLD?.pool;

  // Price + market status + pool NAV.
  const marketReads = useReadContracts({
    contracts: GOLD
      ? [
          { address: GOLD.oracle, abi: equityOracleAbi, functionName: "priceWad", args: [GOLD.feedId] } as const,
          { address: GOLD.pool, abi: equityPoolAbi, functionName: "marketOpen" } as const,
          { address: GOLD.pool, abi: equityPoolAbi, functionName: "totalAssets" } as const,
        ]
      : [],
    chainId: activeChain.id,
    query: { enabled: live, refetchInterval: 12_000 },
  });
  const priceRaw = marketReads.data?.[0]?.result as [bigint, bigint] | undefined;
  const price = priceRaw && priceRaw[0] > 0n ? Number(priceRaw[0]) / 1e18 : undefined;
  const marketOpen = marketReads.data?.[1]?.result as boolean | undefined;
  const marketClosed = marketOpen === false;
  const nav = marketReads.data?.[2]?.result as bigint | undefined;

  const reads = useReadContracts({
    contracts: GOLD
      ? [
          { address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [address!] } as const,
          { address: USDT0, abi: erc20Abi, functionName: "allowance", args: [address!, GOLD.pool] } as const,
          { address: GOLD.pool, abi: equityPoolAbi, functionName: "maxWithdraw", args: [address!] } as const,
          { address: GOLD.pool, abi: equityPoolAbi, functionName: "maxRedeem", args: [address!] } as const,
        ]
      : [],
    chainId: activeChain.id,
    query: { enabled: Boolean(address) && !wrongChain && live, refetchInterval: 12_000 },
  });
  const walletBal = reads.data?.[0]?.result as bigint | undefined;
  const allowance = reads.data?.[1]?.result as bigint | undefined;
  const position = reads.data?.[2]?.result as bigint | undefined; // marked NAV of the user's shares
  const shares = reads.data?.[3]?.result as bigint | undefined; // the user's pool shares (maxRedeem)

  const { writeContract, data: hash, isPending, reset, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const pending = useRef<{ action: "approve" | "deposit" | "withdraw"; amountWei: bigint; est?: bigint } | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelReset = () => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  };

  function doDeposit(amt: bigint) {
    if (!poolAddr) return;
    cancelReset();
    pending.current = { action: "deposit", amountWei: amt };
    writeContract({ address: poolAddr, abi: equityPoolAbi, functionName: "deposit", args: [amt, address!], chainId: activeChain.id });
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
    marketReads.refetch();
    setAmount("");
    pending.current = null;
    const msg =
      p?.action === "deposit"
        ? "Deposit confirmed"
        : p?.est !== undefined
          ? `Withdrawal confirmed — you received ≈ ${fmt(p.est)} USDT0`
          : "Withdrawal confirmed";
    toast.success(msg, {
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

  // Withdraw settles at realizable value: redeem the shares matching the requested amount (all shares
  // for a full exit), so the pool returns what it can actually realize, not the marked figure.
  const sharesToRedeem = useMemo(() => {
    if (tab !== "withdraw" || !shares || !position || position === 0n || amountWei <= 0n) return 0n;
    return amountWei >= position ? shares : (shares * amountWei) / position;
  }, [tab, shares, position, amountWei]);

  const withdrawSim = useSimulateContract({
    address: poolAddr,
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
    if (!address || !poolAddr || amountWei <= 0n) return;
    cancelReset();
    if (tab === "deposit") {
      if (needsApproval) {
        pending.current = { action: "approve", amountWei };
        writeContract({ address: USDT0, abi: erc20Abi, functionName: "approve", args: [poolAddr, amountWei], chainId: activeChain.id });
      } else {
        doDeposit(amountWei);
      }
    } else {
      if (sharesToRedeem <= 0n) return;
      pending.current = { action: "withdraw", amountWei, est: estOut };
      writeContract({ address: poolAddr, abi: equityPoolAbi, functionName: "redeem", args: [sharesToRedeem, address, address], chainId: activeChain.id });
    }
  }

  const label = !isConnected
    ? "Connect wallet"
    : wrongChain
      ? switching ? "Switching…" : `Switch to ${activeChain.name}`
      : marketClosed
        ? "Gold market closed"
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
          <h1 className="text-xl font-medium tracking-tight">Gold</h1>
          <Badge tone="negative">At-risk</Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          Opt-in exposure to tokenized gold (PAXGy, Paxos&apos; yield-bearing gold), priced by an on-chain
          gold rate plus a gold/USD feed Aumo runs. Its own isolated pool, separate from the safe USDT0
          treasury. Not capital preservation — its value moves with the gold price.
        </span>
      </header>

      {!live ? (
        <Panel className="p-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            The gold pool launches on X Layer once the mainnet oracle is wired.
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Position + asset */}
          <div className="flex flex-col gap-6">
            <Panel className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <GoldCoin size={40} />
                  <div>
                    <Label>Your position · {GOLD!.symbol}</Label>
                    <div className="mt-1.5 text-3xl font-medium text-foreground">
                      <Num value={num(position)} currency />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {marketClosed
                        ? "Redeemable when the gold market reopens"
                        : "Marked value; redeems to USDT0 at the gold price on exit"}
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
                  <Label>{GOLD!.symbol} price</Label>
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
                You deposit USDT0; the agent converts it to {GOLD!.symbol} (tokenized gold) and back. When
                you withdraw, the gold is sold and you receive USDT0 — more or less than you put in,
                depending on where gold has moved.
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

            {marketClosed ? (
              <div className="mb-4 rounded-lg border border-border bg-card-2 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                <span className="text-foreground">The gold market is closed.</span> Deposits and withdrawals
                pause over the weekend gold gap and reopen when metals trading resumes. Your position stays
                valued at the last price.
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

            {tab === "withdraw" && amountWei > 0n && !marketClosed ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                You receive {estOut !== undefined ? `≈ ${fmt(estOut)}` : "…"} USDT0. The exit sells the gold
                at the current price, so a small spread applies and the final amount can differ.
              </p>
            ) : null}

            {tab === "deposit" && !marketClosed ? (
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
                <span>I understand this pool holds tokenized-gold exposure, is not capital preservation, and can lose value.</span>
              </label>
            ) : null}

            <div className="mt-5">
              {!isConnected ? (
                <ConnectButton />
              ) : (
                <button
                  className={primaryBtn}
                  disabled={wrongChain ? switching : busy || marketOpen !== true || amountWei <= 0n || overMax || depositBlocked}
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
      )}

      <section className="grid grid-cols-1 gap-8 border-t border-border pt-8 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Label>How it works</Label>
          <ol className="flex flex-col gap-4">
            {[
              "Deposit USDT0 into the gold pool. It's its own isolated pool, separate from the safe treasury.",
              "The agent converts it to PAXGy (Paxos' yield-bearing tokenized gold) through an on-chain swap, within hard caps the owner set. PAXGy's gold entitlement grows over time.",
              "Withdraw while gold is trading: the PAXGy is sold and you get USDT0 back at the current price, more or less than you put in. Over the weekend gold gap, entry and exit pause.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="tnum flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card-2 text-xs font-medium text-foreground">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-4">
          <Label>What you&apos;re taking on</Label>
          <ul className="flex flex-col gap-3">
            {[
              ["Price risk", "This is not capital preservation. The pool's value moves with the price of gold, and you can withdraw less than you deposited."],
              ["Weekend freeze", "Gold trades roughly 24/5. Deposits and withdrawals pause over the weekend gold gap so no one transacts across it."],
              ["Spread and slippage", "Every buy and sell crosses a spread through the PAXGy/USDG pool, so a quick in-and-out costs a little even if gold hasn't moved."],
              ["Oracle dependency", "PAXGy is marked from its on-chain gold rate and a gold/USD feed Aumo runs, with on-chain guards; if it goes stale the pool refuses to trade rather than transact on a blind price."],
              ["Issuer trust", "PAXGy is issued by Paxos, which can freeze or pause its token. Standard for a regulated RWA, and the same trust class as the other real-world assets Aumo holds."],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-negative/70" />
                <span className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">{title}.</span> {body}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
