import { pad, parseAbi, type Address } from "viem";
import { mainnet, arbitrum, optimism, polygon } from "viem/chains";
import { xlayerMainnet } from "./chain";

// Cross-chain deposits onto X Layer over USDT0's native LayerZero OFT. A user holding USDT/USDT0 on
// Ethereum, Arbitrum, Optimism, or Polygon sends it to their own address on X Layer, then deposits
// as usual. Every address here was verified on-chain: each source OFT peers to the X Layer OFT and
// carries enforced executor options, so a send with empty extraOptions is delivered safely.
//
// The receiving side on X Layer (for reference / reverse direction):
export const XLAYER_EID = 30274;
export const XLAYER_OFT = "0x94bCCa6bDFd6a61817ab0e960BFEDe4984505554" as const; // token()=USDT0
export const XLAYER_USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;

export interface BridgeChain {
  key: string;
  name: string;
  chainId: number; // numeric chain id, for switching the wallet
  eid: number; // LayerZero endpoint id
  oft: Address; // the OFT contract we call send() on
  token: Address; // the ERC20 the OFT moves (approve target when approvalRequired)
  nativeSymbol: string; // gas token the LayerZero fee is paid in
}

// Verified on-chain (token(), approvalRequired(), peers(30274)):
//   ethereum  adapter over USDT,  approvalRequired = true
//   arbitrum  adapter over USDT0, approvalRequired = false
//   optimism  adapter over USDT0, approvalRequired = false
//   polygon   adapter over USDT,  approvalRequired = false
// approvalRequired() is read live per send, so the widget never assumes; this is documentation.
export const BRIDGE_CHAINS: Record<string, BridgeChain> = {
  arbitrum: {
    key: "arbitrum",
    name: "Arbitrum",
    chainId: arbitrum.id,
    eid: 30110,
    oft: "0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92",
    token: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    nativeSymbol: "ETH",
  },
  optimism: {
    key: "optimism",
    name: "Optimism",
    chainId: optimism.id,
    eid: 30111,
    oft: "0xF03b4d9AC1D5d1E7c4cEf54C2A313b9fe051A0aD",
    token: "0x01bFF41798a0BcF287b996046Ca68b395DbC1071",
    nativeSymbol: "ETH",
  },
  polygon: {
    key: "polygon",
    name: "Polygon",
    chainId: polygon.id,
    eid: 30109,
    oft: "0x6BA10300f0DC58B7a1e4c0e41f5daBb7D7829e13",
    token: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    nativeSymbol: "POL",
  },
  ethereum: {
    key: "ethereum",
    name: "Ethereum",
    chainId: mainnet.id,
    eid: 30101,
    oft: "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee",
    token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    nativeSymbol: "ETH",
  },
};

// Order shown in the picker: cheapest gas first, Ethereum last.
export const BRIDGE_CHAIN_LIST: BridgeChain[] = [
  BRIDGE_CHAINS.arbitrum,
  BRIDGE_CHAINS.optimism,
  BRIDGE_CHAINS.polygon,
  BRIDGE_CHAINS.ethereum,
];

// X Layer as a send origin, for the outbound leg (X Layer -> another chain, e.g. to move withdrawn
// yield off-chain). Verified on-chain: the OFT wraps USDT0, approvalRequired = false, and it peers to
// every destination above with enforced executor options set, so an empty-options send is delivered.
export const XLAYER_CHAIN: BridgeChain = {
  key: "xlayer",
  name: "X Layer",
  chainId: xlayerMainnet.id,
  eid: XLAYER_EID,
  oft: XLAYER_OFT,
  token: XLAYER_USDT0,
  nativeSymbol: "OKB",
};

export const oftAbi = parseAbi([
  "struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }",
  "struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }",
  "struct MessagingReceipt { bytes32 guid; uint64 nonce; MessagingFee fee; }",
  "struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }",
  "function token() view returns (address)",
  "function approvalRequired() view returns (bool)",
  "function quoteSend(SendParam sendParam, bool payInLzToken) view returns (MessagingFee)",
  "function send(SendParam sendParam, MessagingFee fee, address refundAddress) payable returns (MessagingReceipt, OFTReceipt)",
]);

export const bridgeErc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

// USDT0 OFT uses 6 shared decimals and its tokens are all 6-decimal, so amountLD == the typed
// amount and minAmountLD can equal it (1:1, no dust removed). Recipient is the user's own address on
// the destination chain, padded to bytes32; dstEid selects that chain's LayerZero endpoint.
export function buildSendParam(recipient: Address, amountLD: bigint, dstEid: number) {
  return {
    dstEid,
    to: pad(recipient, { size: 32 }),
    amountLD,
    minAmountLD: amountLD,
    extraOptions: "0x" as `0x${string}`,
    composeMsg: "0x" as `0x${string}`,
    oftCmd: "0x" as `0x${string}`,
  } as const;
}

// On by default now that every route is verified on-chain both directions (peers + enforced executor
// options). NEXT_PUBLIC_BRIDGE_ENABLED=0 is a kill switch to hide the widget instantly if a real
// send ever misbehaves, without a code change.
export const BRIDGE_ENABLED = process.env.NEXT_PUBLIC_BRIDGE_ENABLED !== "0";

// LayerZero scan tracks a cross-chain message by its source-chain tx hash.
export const lzScanUrl = (txHash: string) => `https://layerzeroscan.com/tx/${txHash}`;
