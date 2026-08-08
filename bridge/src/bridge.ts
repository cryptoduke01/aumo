import {
  createPublicClient,
  createWalletClient,
  http,
  pad,
  defineChain,
  formatEther,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { oftAbi, erc20Abi } from "./oftAbi.js";
import { resolveChain, XLAYER_EID, XLAYER_USDT0, type OftChain } from "./chains.js";

export interface SendParam {
  dstEid: number;
  to: `0x${string}`;
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: `0x${string}`;
  composeMsg: `0x${string}`;
  oftCmd: `0x${string}`;
}

export function toBytes32(addr: Address): `0x${string}` {
  return pad(addr, { size: 32 });
}

export function buildSendParam(to: Address, amount: bigint, slippageBps: number): SendParam {
  const minAmountLD = amount - (amount * BigInt(slippageBps)) / 10000n;
  return {
    dstEid: XLAYER_EID,
    to: toBytes32(to),
    amountLD: amount,
    minAmountLD,
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };
}

function rpcFor(src: OftChain, override?: string) {
  return createPublicClient({ transport: http(override && override.length ? override : src.rpc) });
}

export interface Quote {
  source: OftChain;
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  amountLD: bigint;
  minReceivedLD: bigint;
  nativeFeeWei: bigint;
  nativeFeeEth: string;
  destination: { eid: number; usdt0: Address; recipient: Address };
}

/** Read-only. Quotes the LayerZero native fee and confirms the route resolves. */
export async function quote(
  sourceKey: string,
  recipient: Address,
  amount: bigint,
  slippageBps: number,
  rpcOverride?: string,
): Promise<Quote> {
  const source = resolveChain(sourceKey);
  const pc = rpcFor(source, rpcOverride);
  const sp = buildSendParam(recipient, amount, slippageBps);

  const [token, fee] = await Promise.all([
    pc.readContract({ address: source.oft, abi: oftAbi, functionName: "token" }),
    pc.readContract({ address: source.oft, abi: oftAbi, functionName: "quoteSend", args: [sp, false] }),
  ]);
  const [tokenSymbol, tokenDecimals] = await Promise.all([
    pc.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    pc.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);

  return {
    source,
    token,
    tokenSymbol,
    tokenDecimals: Number(tokenDecimals),
    amountLD: amount,
    minReceivedLD: sp.minAmountLD,
    nativeFeeWei: fee.nativeFee,
    nativeFeeEth: formatEther(fee.nativeFee),
    destination: { eid: XLAYER_EID, usdt0: XLAYER_USDT0, recipient },
  };
}

export interface SendResult {
  txHash: `0x${string}`;
  approvalTxHash?: `0x${string}`;
  amountLD: bigint;
  recipient: Address;
}

/**
 * Executes the bridge: approves the OFT if required, then sends USDT0 to X Layer.
 * Spends real funds and native gas — callers gate this behind an explicit switch.
 */
export async function send(
  sourceKey: string,
  privateKey: `0x${string}`,
  recipient: Address,
  amount: bigint,
  slippageBps: number,
  rpcOverride?: string,
): Promise<SendResult> {
  const source = resolveChain(sourceKey);
  const rpc = rpcOverride && rpcOverride.length ? rpcOverride : source.rpc;
  const chain = defineChain({
    id: source.chainId,
    name: source.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const pc = createPublicClient({ chain, transport: http(rpc) });
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  const sp = buildSendParam(recipient, amount, slippageBps);
  const [token, approvalRequired, fee] = await Promise.all([
    pc.readContract({ address: source.oft, abi: oftAbi, functionName: "token" }),
    pc.readContract({ address: source.oft, abi: oftAbi, functionName: "approvalRequired" }),
    pc.readContract({ address: source.oft, abi: oftAbi, functionName: "quoteSend", args: [sp, false] }),
  ]);

  let approvalTxHash: `0x${string}` | undefined;
  if (approvalRequired) {
    const allowance = await pc.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, source.oft],
    });
    if (allowance < amount) {
      approvalTxHash = await wallet.writeContract({
        account,
        chain,
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [source.oft, amount],
      });
      await pc.waitForTransactionReceipt({ hash: approvalTxHash });
    }
  }

  const txHash = await wallet.writeContract({
    account,
    chain,
    address: source.oft,
    abi: oftAbi,
    functionName: "send",
    args: [sp, { nativeFee: fee.nativeFee, lzTokenFee: 0n }, account.address],
    value: fee.nativeFee,
  });
  await pc.waitForTransactionReceipt({ hash: txHash });

  return { txHash, approvalTxHash, amountLD: amount, recipient };
}
