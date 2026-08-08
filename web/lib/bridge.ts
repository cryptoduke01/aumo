import { createPublicClient, http, pad, parseAbi, formatEther, type Address } from "viem";

// USDT0's native LayerZero OFT — the bridge onto X Layer. Read-only quoting here; the send is
// a mainnet action from the user's wallet.
export const XLAYER_EID = 30274;
export const XLAYER_USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;

export interface OftChain {
  key: string;
  name: string;
  eid: number;
  oft: Address;
  rpc: string;
}

// publicnode endpoints are keyless and reachable from serverless (many public RPCs block cloud IPs).
export const BRIDGE_CHAINS: Record<string, OftChain> = {
  ethereum: { key: "ethereum", name: "Ethereum", eid: 30101, oft: "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee", rpc: "https://ethereum-rpc.publicnode.com" },
  arbitrum: { key: "arbitrum", name: "Arbitrum", eid: 30110, oft: "0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92", rpc: "https://arbitrum-one-rpc.publicnode.com" },
  optimism: { key: "optimism", name: "Optimism", eid: 30111, oft: "0xF03b4d9AC1D5d1E7c4cEf54C2A313b9fe051A0aD", rpc: "https://optimism-rpc.publicnode.com" },
  polygon: { key: "polygon", name: "Polygon", eid: 30109, oft: "0x6BA10300f0DC58B7a1e4c0e41f5daBb7D7829e13", rpc: "https://polygon-bor-rpc.publicnode.com" },
};

const oftAbi = parseAbi([
  "struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }",
  "struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }",
  "function token() view returns (address)",
  "function quoteSend(SendParam sendParam, bool payInLzToken) view returns (MessagingFee)",
]);
const erc20Abi = parseAbi(["function symbol() view returns (string)"]);

export interface BridgeQuote {
  source: string;
  eid: number;
  tokenSymbol: string;
  nativeFeeEth: string;
  destination: string;
}

export async function quoteBridge(
  sourceKey: string,
  recipient: Address,
  amountUnits: bigint,
): Promise<BridgeQuote> {
  const src = BRIDGE_CHAINS[sourceKey];
  if (!src) throw new Error(`unknown chain ${sourceKey}`);
  const pc = createPublicClient({ transport: http(src.rpc) });
  const sendParam = {
    dstEid: XLAYER_EID,
    to: pad(recipient, { size: 32 }),
    amountLD: amountUnits,
    minAmountLD: amountUnits,
    extraOptions: "0x" as const,
    composeMsg: "0x" as const,
    oftCmd: "0x" as const,
  };
  const [token, fee] = await Promise.all([
    pc.readContract({ address: src.oft, abi: oftAbi, functionName: "token" }),
    pc.readContract({ address: src.oft, abi: oftAbi, functionName: "quoteSend", args: [sendParam, false] }),
  ]);
  const tokenSymbol = await pc.readContract({ address: token, abi: erc20Abi, functionName: "symbol" });
  return {
    source: src.name,
    eid: src.eid,
    tokenSymbol,
    nativeFeeEth: formatEther(fee.nativeFee),
    destination: "X Layer",
  };
}
