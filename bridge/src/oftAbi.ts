import { parseAbi } from "viem";

/** LayerZero OFT v2 surface used to quote and send a cross-chain transfer. */
export const oftAbi = parseAbi([
  "struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }",
  "struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }",
  "struct MessagingReceipt { bytes32 guid; uint64 nonce; MessagingFee fee; }",
  "struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }",
  "struct OFTLimit { uint256 minAmountLD; uint256 maxAmountLD; }",
  "struct OFTFeeDetail { int256 feeAmountLD; string description; }",
  "function token() view returns (address)",
  "function approvalRequired() view returns (bool)",
  "function quoteSend(SendParam sendParam, bool payInLzToken) view returns (MessagingFee)",
  "function quoteOFT(SendParam sendParam) view returns (OFTLimit, OFTFeeDetail[], OFTReceipt)",
  "function send(SendParam sendParam, MessagingFee fee, address refundAddress) payable returns (MessagingReceipt, OFTReceipt)",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
