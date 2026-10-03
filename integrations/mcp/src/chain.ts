import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  ExecutionRevertedError,
  http,
  type Address,
  type Hex,
} from "viem";
import { POOL, USDT0, xlayer } from "./config.js";
import { erc20Abi, poolAbi } from "./tx.js";

// Read-only X Layer access. Every call here is an eth_call or a view read: there is no wallet,
// no account with a key, and no method that sends a transaction.

export interface PoolState {
  paused: boolean;
  totalAssets: bigint;
  totalSupply: bigint;
  shareDecimals: number;
}

export interface Position {
  shares: bigint;
  redeemable: bigint; // maxWithdraw: USDT0 the owner could pull now, net of any exit levy
  walletAsset: bigint; // USDT0 in the wallet
  allowance: bigint; // USDT0 allowance granted to the pool
  pool: PoolState;
}

export type Simulation =
  | { status: "ok" }
  | { status: "reverts"; reason: string }
  | { status: "unknown"; reason: string };

export interface ChainReader {
  poolState(): Promise<PoolState>;
  position(owner: Address): Promise<Position>;
  previewDeposit(assets: bigint): Promise<bigint>;
  previewWithdraw(assets: bigint): Promise<bigint>;
  previewRedeem(shares: bigint): Promise<bigint>;
  simulate(tx: { from: Address; to: Address; data: Hex }): Promise<Simulation>;
}

export function createChainReader(rpcUrl: string): ChainReader {
  const pc = createPublicClient({ chain: xlayer(rpcUrl), transport: http(rpcUrl, { timeout: 15_000 }) });
  const pool = { address: POOL, abi: poolAbi } as const;

  async function poolState(): Promise<PoolState> {
    const [paused, totalAssets, totalSupply, shareDecimals] = await Promise.all([
      pc.readContract({ ...pool, functionName: "paused" }),
      pc.readContract({ ...pool, functionName: "totalAssets" }),
      pc.readContract({ ...pool, functionName: "totalSupply" }),
      pc.readContract({ ...pool, functionName: "decimals" }),
    ]);
    return { paused, totalAssets, totalSupply, shareDecimals: Number(shareDecimals) };
  }

  return {
    poolState,

    async position(owner) {
      const [shares, redeemable, walletAsset, allowance, state] = await Promise.all([
        pc.readContract({ ...pool, functionName: "balanceOf", args: [owner] }),
        pc.readContract({ ...pool, functionName: "maxWithdraw", args: [owner] }),
        pc.readContract({ address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
        pc.readContract({ address: USDT0, abi: erc20Abi, functionName: "allowance", args: [owner, POOL] }),
        poolState(),
      ]);
      return { shares, redeemable, walletAsset, allowance, pool: state };
    },

    previewDeposit: (assets) => pc.readContract({ ...pool, functionName: "previewDeposit", args: [assets] }),
    previewWithdraw: (assets) => pc.readContract({ ...pool, functionName: "previewWithdraw", args: [assets] }),
    previewRedeem: (shares) => pc.readContract({ ...pool, functionName: "previewRedeem", args: [shares] }),

    async simulate({ from, to, data }) {
      try {
        await pc.call({ account: from, to, data });
        return { status: "ok" };
      } catch (e) {
        return classifyCallError(e);
      }
    },
  };
}

/**
 * Separate a genuine contract revert (the transaction would fail on-chain) from an RPC or network
 * problem (we simply could not tell). Mirrors the web app's withdraw probe, which refuses to read a
 * laggy node as a revert.
 */
export function classifyCallError(e: unknown): Simulation {
  if (e instanceof BaseError) {
    const reverted = e.walk(
      (err) => err instanceof ExecutionRevertedError || err instanceof ContractFunctionRevertedError,
    );
    if (reverted) return { status: "reverts", reason: (reverted as BaseError).shortMessage || e.shortMessage };
    const msg = e.shortMessage || e.message;
    if (/revert|exceeds|insufficient/i.test(msg)) return { status: "reverts", reason: msg };
    return { status: "unknown", reason: msg };
  }
  return { status: "unknown", reason: e instanceof Error ? e.message : String(e) };
}
