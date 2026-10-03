import { encodeFunctionData, formatUnits, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { ASSET_DECIMALS, ASSET_SYMBOL, CHAIN_ID, POOL, USDT0 } from "./config.js";

// Pure calldata builders. Nothing here signs or sends: each function returns an unsigned
// transaction request for the caller's own wallet to review, sign, and broadcast.

// Same function signatures the web app writes through (web/lib/chain.ts poolAbi / erc20Abi), which
// match AumoPool.sol (OpenZeppelin ERC4626) and the USDT0 ERC-20.
export const poolAbi = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function paused() view returns (bool)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

/** An unsigned EVM transaction request. `value` is always "0": no native OKB is ever sent. */
export interface UnsignedTx {
  step: number;
  kind: "approve" | "deposit" | "withdraw" | "redeem";
  chainId: typeof CHAIN_ID;
  from: Address;
  to: Address;
  data: Hex;
  value: "0";
  summary: string;
}

const AMOUNT_RE = new RegExp(`^(\\d+)(\\.\\d{1,${ASSET_DECIMALS}})?$`);

/**
 * Parse a human USDT0 amount ("25", "25.5", "0.000001") into base units. Rejects negatives,
 * exponents, more than 6 decimals, and zero, so a caller can never encode a surprise amount.
 */
export function parseAssetAmount(input: string): bigint {
  const s = input.trim();
  if (!AMOUNT_RE.test(s)) {
    throw new Error(`Invalid amount "${input}": use a plain decimal like "25" or "25.5" with at most ${ASSET_DECIMALS} decimals.`);
  }
  const v = parseUnits(s, ASSET_DECIMALS);
  if (v <= 0n) throw new Error("Amount must be greater than zero.");
  return v;
}

export const fmtAsset = (v: bigint) => formatUnits(v, ASSET_DECIMALS);

export function buildApproveTx(from: Address, amount: bigint, step = 1): UnsignedTx {
  return {
    step,
    kind: "approve",
    chainId: CHAIN_ID,
    from,
    to: USDT0,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [POOL, amount] }),
    value: "0",
    summary: `Approve the Aumo pool (${POOL}) to pull exactly ${fmtAsset(amount)} ${ASSET_SYMBOL} from ${from}.`,
  };
}

export function buildDepositTx(from: Address, amount: bigint, receiver: Address, step = 1): UnsignedTx {
  return {
    step,
    kind: "deposit",
    chainId: CHAIN_ID,
    from,
    to: POOL,
    data: encodeFunctionData({ abi: poolAbi, functionName: "deposit", args: [amount, receiver] }),
    value: "0",
    summary: `Deposit ${fmtAsset(amount)} ${ASSET_SYMBOL} into the Aumo pool; pool shares go to ${receiver}.`,
  };
}

export function buildWithdrawTx(owner: Address, amount: bigint, receiver: Address, step = 1): UnsignedTx {
  return {
    step,
    kind: "withdraw",
    chainId: CHAIN_ID,
    from: owner,
    to: POOL,
    data: encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [amount, receiver, owner] }),
    value: "0",
    summary: `Withdraw ${fmtAsset(amount)} ${ASSET_SYMBOL} from the Aumo pool to ${receiver}, burning the matching shares of ${owner}.`,
  };
}

export function buildRedeemTx(owner: Address, shares: bigint, receiver: Address, sharesLabel: string, step = 1): UnsignedTx {
  return {
    step,
    kind: "redeem",
    chainId: CHAIN_ID,
    from: owner,
    to: POOL,
    data: encodeFunctionData({ abi: poolAbi, functionName: "redeem", args: [shares, receiver, owner] }),
    value: "0",
    summary: `Redeem all ${sharesLabel} pool shares of ${owner} for ${ASSET_SYMBOL}, paid to ${receiver}.`,
  };
}
