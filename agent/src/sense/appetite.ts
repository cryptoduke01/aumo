import type { PublicClient, Address } from "viem";
import { vaultAbi } from "../chain/abi.js";
import type { RiskBand } from "../types.js";

/**
 * Collective risk steering. Depositors declare an appetite tier on-chain (1 conservative, 2 moderate,
 * 3 bold). Individual per-user allocations aren't possible in a single pooled vault, so we aggregate:
 * share-weight everyone's tier by their pool balance and map the result to a risk band. The agent
 * then uses the MORE CONSERVATIVE of this and the owner's hard ceiling — depositors can steer the
 * pool safer, or up to (never past) the on-chain hard bound. Read-only and best-effort: any failure
 * returns null and the agent falls back to its configured appetite.
 */

const RISK_APPETITE_EVENT = {
  type: "event",
  name: "RiskAppetiteSet",
  inputs: [
    { indexed: true, name: "depositor", type: "address" },
    { indexed: false, name: "tier", type: "uint8" },
  ],
} as const;

export interface DepositorAppetite {
  band: RiskBand; // share-weighted aggregate
  avgTier: number; // 1..3
  voters: number; // depositors who set a preference and still hold shares
}

export async function readDepositorAppetite(
  pc: PublicClient,
  pool: Address,
  fromBlock: bigint = 0n,
): Promise<DepositorAppetite | null> {
  let addrs: Address[];
  try {
    const logs = await pc.getLogs({ address: pool, event: RISK_APPETITE_EVENT, fromBlock, toBlock: "latest" });
    addrs = [...new Set(logs.map((l) => (l.args.depositor as Address).toLowerCase() as Address))];
  } catch {
    return null;
  }
  if (addrs.length === 0) return null;

  // Current tier + current share balance for each depositor who ever expressed a preference.
  let res;
  try {
    res = await pc.multicall({
      allowFailure: true,
      contracts: addrs.flatMap((a) => [
        { address: pool, abi: vaultAbi, functionName: "riskAppetiteOf", args: [a] } as const,
        { address: pool, abi: vaultAbi, functionName: "balanceOf", args: [a] } as const,
      ]),
    });
  } catch {
    return null;
  }

  let weighted = 0;
  let totalShares = 0;
  let voters = 0;
  for (let i = 0; i < addrs.length; i++) {
    const tier = Number(res[2 * i]?.result ?? 0);
    const bal = res[2 * i + 1]?.result;
    const shares = typeof bal === "bigint" ? Number(bal) : 0;
    if (tier < 1 || tier > 3 || shares <= 0) continue; // no preference, or they've exited
    weighted += tier * shares;
    totalShares += shares;
    voters += 1;
  }
  if (totalShares <= 0) return null;

  const avgTier = weighted / totalShares;
  const band: RiskBand = avgTier < 1.67 ? "low" : avgTier < 2.33 ? "moderate" : "elevated";
  return { band, avgTier, voters };
}
