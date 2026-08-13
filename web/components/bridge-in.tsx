"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatEther, formatUnits, parseUnits, type Address } from "viem";
import { toast } from "sonner";
import { Panel, Label } from "@/components/ui";
import { Orb } from "@/components/orb";
import {
  BRIDGE_CHAINS,
  BRIDGE_CHAIN_LIST,
  XLAYER_CHAIN,
  XLAYER_EID,
  bridgeErc20Abi,
  buildSendParam,
  lzScanUrl,
  oftAbi,
} from "@/lib/bridge";
import {
  addBridge,
  fetchBridgeStatus,
  getBridges,
  removeBridge,
  type BridgeStatus,
  type PendingBridge,
} from "@/lib/bridge-history";

const btn =
  "chamfer inline-flex w-full items-center justify-center bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-[transform,opacity] hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40";

type Direction = "in" | "out";

/**
 * Move USDT0 across chains over its native LayerZero OFT, in either direction:
 *  - "in":  another chain -> X Layer (fund a deposit)
 *  - "out": X Layer -> another chain (take withdrawn yield off X Layer)
 * The flow is symmetric: be on the origin chain, approve only when the origin OFT reports
 * approvalRequired (Ethereum inbound; never for X Layer), and send to the user's own address on the
 * destination. Delivery is asynchronous, so every send is recorded and shown as "in flight" with a
 * live LayerZero status until it lands (see PendingBridges) — the balance on the destination stays 0
 * until then, and this stops that from reading as lost funds.
 */
export function BridgeIn() {
  const { address, chainId: walletChainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [direction, setDirection] = useState<Direction>("in");
  const [inKey, setInKey] = useState("arbitrum"); // source when bringing in
  const [outKey, setOutKey] = useState("arbitrum"); // destination when sending out
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<PendingBridge[]>([]);
  useEffect(() => setPending(getBridges()), []);

  // The chain we transact ON (origin) and the destination endpoint.
  const src = direction === "in" ? BRIDGE_CHAINS[inKey] : XLAYER_CHAIN;
  const dstEid = direction === "in" ? XLAYER_EID : BRIDGE_CHAINS[outKey].eid;
  const destName = direction === "in" ? "X Layer" : BRIDGE_CHAINS[outKey].name;
  const pickedKey = direction === "in" ? inKey : outKey;
  const onSrcChain = walletChainId === src.chainId;

  const reads = useReadContracts({
    contracts: [
      { chainId: src.chainId, address: src.token, abi: bridgeErc20Abi, functionName: "decimals" },
      { chainId: src.chainId, address: src.token, abi: bridgeErc20Abi, functionName: "symbol" },
      { chainId: src.chainId, address: src.token, abi: bridgeErc20Abi, functionName: "balanceOf", args: [address!] },
      { chainId: src.chainId, address: src.oft, abi: oftAbi, functionName: "approvalRequired" },
      { chainId: src.chainId, address: src.token, abi: bridgeErc20Abi, functionName: "allowance", args: [address!, src.oft] },
    ],
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
  const decimals = (reads.data?.[0]?.result as number | undefined) ?? 6;
  const symbol = (reads.data?.[1]?.result as string | undefined) ?? "USDT0";
  const balance = reads.data?.[2]?.result as bigint | undefined;
  const approvalRequired = reads.data?.[3]?.result as boolean | undefined;
  const allowance = reads.data?.[4]?.result as bigint | undefined;

  const amountLD = useMemo(() => {
    try {
      return amount ? parseUnits(amount, decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amount, decimals]);

  const sendParam = useMemo(
    () => (address && amountLD > 0n ? buildSendParam(address as Address, amountLD, dstEid) : undefined),
    [address, amountLD, dstEid],
  );

  // Live LayerZero fee quote on the origin chain. nativeFee is the msg.value the send must carry.
  const quote = useReadContract({
    chainId: src.chainId,
    address: src.oft,
    abi: oftAbi,
    functionName: "quoteSend",
    args: sendParam ? [sendParam, false] : undefined,
    query: { enabled: Boolean(sendParam), refetchInterval: 15_000 },
  });
  const nativeFee = (quote.data as { nativeFee: bigint } | undefined)?.nativeFee;

  const overBalance = balance !== undefined && amountLD > balance;
  const needsApproval = Boolean(approvalRequired) && (allowance ?? 0n) < amountLD;

  const { writeContract, data: hash, isPending, reset, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash, chainId: src.chainId });
  // Approve and send are two txs; this carries the amount (and the labels to record) across so the
  // send fires automatically once the approval confirms (mirrors the deposit flow).
  const pendingTx = useRef<{ action: "approve" | "send"; amountLD: bigint; srcName: string; destName: string; symbol: string; decimals: number } | null>(null);
  const busy = isPending || receipt.isLoading;

  function doSend(amt: bigint) {
    if (!address || nativeFee === undefined) return;
    pendingTx.current = { action: "send", amountLD: amt, srcName: src.name, destName, symbol, decimals };
    writeContract({
      chainId: src.chainId,
      address: src.oft,
      abi: oftAbi,
      functionName: "send",
      args: [buildSendParam(address as Address, amt, dstEid), { nativeFee, lzTokenFee: 0n }, address],
      value: nativeFee,
    });
  }

  useEffect(() => {
    if (!receipt.isSuccess) return;
    // A reverted tx also yields a receipt — gate on the real on-chain status so a reverted approve
    // never auto-fires a send.
    if (receipt.data?.status !== "success") {
      if (receipt.data?.status === "reverted") {
        pendingTx.current = null;
        toast.error("Transaction reverted on-chain. No funds moved.");
        reset();
      }
      return;
    }
    const p = pendingTx.current;
    reads.refetch();
    if (p?.action === "approve") {
      toast.success("Approved — confirming the bridge…");
      const amt = p.amountLD;
      reset();
      setTimeout(() => doSend(amt), 0);
      return;
    }
    // send settled — record it so it shows as in-flight until LayerZero delivers
    if (hash && p) {
      addBridge({
        hash,
        srcName: p.srcName,
        destName: p.destName,
        amount: formatUnits(p.amountLD, p.decimals),
        symbol: p.symbol,
        at: Date.now(),
      });
      setPending(getBridges());
    }
    setAmount("");
    pendingTx.current = null;
    toast.success(`Bridge sent — tracking delivery to ${p?.destName ?? destName}`, {
      action: hash ? { label: "Track", onClick: () => window.open(lzScanUrl(hash), "_blank") } : undefined,
    });
    reset();
  }, [receipt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (error) {
      pendingTx.current = null;
      toast.error(error.message.split("\n")[0].slice(0, 120));
    }
  }, [error]);

  function submit() {
    if (!onSrcChain) {
      switchChain({ chainId: src.chainId });
      return;
    }
    if (!address || amountLD <= 0n || overBalance) return;
    if (needsApproval) {
      pendingTx.current = { action: "approve", amountLD, srcName: src.name, destName, symbol, decimals };
      writeContract({
        chainId: src.chainId,
        address: src.token,
        abi: bridgeErc20Abi,
        functionName: "approve",
        args: [src.oft, amountLD],
      });
    } else {
      doSend(amountLD);
    }
  }

  const dismiss = (h: string) => {
    removeBridge(h);
    setPending(getBridges());
  };

  const label =
    amountLD <= 0n
      ? "Enter an amount"
      : overBalance
        ? `Insufficient ${symbol}`
        : !onSrcChain
          ? switching
            ? "Switching…"
            : `Switch to ${src.name}`
          : busy
            ? "Confirming…"
            : quote.isLoading || nativeFee === undefined
              ? "Fetching fee…"
              : needsApproval
                ? `Approve ${symbol}`
                : `Bridge to ${destName}`;

  const disabled =
    !address ||
    (onSrcChain ? amountLD <= 0n || overBalance || busy || nativeFee === undefined : switching);

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <Label>Bridge USDT0</Label>
        <span className="text-[11px] text-faint">via LayerZero</span>
      </div>

      {pending.length > 0 ? <PendingBridges items={pending} onDismiss={dismiss} /> : null}

      {/* direction */}
      <div className="mt-4 flex rounded-lg border border-border p-1">
        {(
          [
            ["in", "Bring in"],
            ["out", "Send out"],
          ] as const
        ).map(([d, lbl]) => (
          <button
            key={d}
            onClick={() => {
              setDirection(d);
              setAmount("");
              reset();
            }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
              direction === d ? "bg-card-2 text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {direction === "in" ? "From another chain onto X Layer." : "From X Layer to another chain."}
      </p>

      {/* chain picker */}
      <div className="mt-3 flex flex-col gap-1.5">
        <Label>{direction === "in" ? "From" : "To"}</Label>
        <div className="flex flex-wrap gap-2">
          {BRIDGE_CHAIN_LIST.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                if (direction === "in") setInKey(c.key);
                else setOutKey(c.key);
                setAmount("");
                reset();
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                pickedKey === c.key
                  ? "border-primary/50 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Amount</Label>
          <button
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            disabled={balance === undefined}
            onClick={() => balance !== undefined && setAmount(formatUnits(balance, decimals))}
          >
            Max {balance !== undefined ? Number(formatUnits(balance, decimals)).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-"}
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card-2 px-4 py-2.5 focus-within:border-primary/50">
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="field-input tnum w-full min-w-0 bg-transparent text-lg font-medium outline-none placeholder:text-faint"
            aria-label={`Amount to bridge from ${src.name}`}
          />
          <span className="shrink-0 text-xs font-medium text-muted-foreground">{symbol}</span>
        </div>
      </div>

      {nativeFee !== undefined && amountLD > 0n && !overBalance ? (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>LayerZero fee</span>
          <span className="tnum text-foreground">
            ~{Number(formatEther(nativeFee)).toLocaleString("en-US", { maximumFractionDigits: 6 })} {src.nativeSymbol}
          </span>
        </div>
      ) : null}

      <button className={`mt-4 ${btn}`} disabled={disabled} onClick={submit}>
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Orb className="size-3.5 text-primary-foreground" /> {label}
          </span>
        ) : (
          label
        )}
      </button>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {direction === "in" ? (
          <>
            Sends to your own address on X Layer. You&apos;ll pay a LayerZero fee in {src.nativeSymbol} plus gas
            on {src.name}. Delivery takes a few minutes and shows above as in flight until it lands.
          </>
        ) : (
          <>
            Bridges USDT0 from your wallet (withdraw from the vault first). Sends to your own address on {destName},
            with a LayerZero fee in OKB plus gas on X Layer. Delivery takes a few minutes and shows above until it lands.
          </>
        )}
      </p>
    </Panel>
  );
}

/** Persistent list of recent bridge sends with live LayerZero delivery status. */
function PendingBridges({ items, onDismiss }: { items: PendingBridge[]; onDismiss: (hash: string) => void }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Label>Transfers</Label>
      {items.map((b) => (
        <PendingRow key={b.hash} b={b} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function PendingRow({ b, onDismiss }: { b: PendingBridge; onDismiss: (hash: string) => void }) {
  const [status, setStatus] = useState<BridgeStatus>("pending");
  const [, force] = useState(0); // ticks the elapsed-time display

  // Poll LayerZero until the message reaches a terminal state.
  useEffect(() => {
    if (status === "delivered" || status === "failed") return;
    const ctrl = new AbortController();
    const poll = () => fetchBridgeStatus(b.hash, ctrl.signal).then(setStatus).catch(() => {});
    poll();
    const t = setInterval(poll, 20_000);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, [b.hash, status]);

  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const mins = Math.max(0, Math.floor((Date.now() - b.at) / 60000));
  const tone =
    status === "delivered"
      ? "border-accent/40 bg-accent/5"
      : status === "failed"
        ? "border-negative/40 bg-negative/5"
        : "border-border bg-card-2";
  const statusText =
    status === "delivered" ? "Delivered" : status === "failed" ? "Failed" : `In flight · ${mins}m`;
  const statusColor =
    status === "delivered" ? "text-accent" : status === "failed" ? "text-negative" : "text-muted-foreground";

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
      {status === "pending" ? <Orb className="size-3.5 shrink-0 text-accent" /> : null}
      <span className="min-w-0 truncate text-foreground">
        {b.amount} {b.symbol} → {b.destName}
      </span>
      <span className={`ml-auto shrink-0 ${statusColor}`}>{statusText}</span>
      <a
        className="shrink-0 text-accent hover:underline"
        href={lzScanUrl(b.hash)}
        target="_blank"
        rel="noreferrer"
      >
        {status === "failed" ? "retry ↗" : "track ↗"}
      </a>
      {status !== "pending" ? (
        <button
          onClick={() => onDismiss(b.hash)}
          className="shrink-0 text-faint hover:text-foreground"
          aria-label="Dismiss"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
