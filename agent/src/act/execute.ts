import { stringToHex, type WalletClient, type PublicClient } from "viem";
import { vaultAbi } from "../chain/abi.js";
import type { Address } from "../types.js";
import type { Move, Plan } from "../brain/plan.js";

export interface MoveResult {
  move: Move;
  hash?: string;
  status: "sent" | "confirmed" | "reverted" | "skipped" | "error";
  error?: string;
}

function reasonBytes32(tag: string): `0x${string}` {
  // bytes32 fits 31 ascii chars + null; tags are already sliced to 31.
  return stringToHex(tag.slice(0, 31), { size: 32 });
}

/**
 * Execute a plan on-chain. The contract re-checks every guardrail, so the worst a
 * bug here can do is get a transaction reverted — never move funds out of policy.
 */
export async function execute(
  plan: Plan,
  wallet: WalletClient,
  pc: PublicClient,
  vault: Address,
): Promise<MoveResult[]> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account");
  const chain = wallet.chain;
  const results: MoveResult[] = [];

  // Send one move on-chain. The contract re-checks every guardrail, so the worst a bug here can do
  // is get a transaction reverted — never move funds out of policy.
  const runMove = async (move: Move): Promise<MoveResult> => {
    try {
      const hash =
        move.action === "allocate"
          ? await wallet.writeContract({
              account,
              chain,
              address: vault,
              abi: vaultAbi,
              functionName: "allocate",
              args: [move.venue, move.amount, reasonBytes32(move.reasonTag)],
            })
          : await wallet.writeContract({
              account,
              chain,
              address: vault,
              abi: vaultAbi,
              functionName: "deallocate",
              args: [move.venue, move.amount],
            });
      const receipt = await pc.waitForTransactionReceipt({ hash });
      return { move, hash, status: receipt.status === "success" ? "confirmed" : "reverted" };
    } catch (err) {
      return { move, status: "error", error: err instanceof Error ? err.message : String(err) };
    }
  };

  // Retreats first — always reduce risk before adding it.
  const retreats = plan.moves.filter((m) => m.action === "deallocate");
  const deploys = plan.moves.filter((m) => m.action === "allocate");

  for (const move of retreats) results.push(await runMove(move));

  // Enforce the de-risk-first invariant: if any retreat did not confirm, do NOT add new exposure
  // this cycle. Adding elsewhere while still stuck in a venue we tried to exit is exactly the wrong
  // move under the stressed conditions that trigger a retreat. Defer the deploys, recorded honestly.
  if (results.some((r) => r.status !== "confirmed")) {
    for (const move of deploys) {
      results.push({ move, status: "skipped", error: "retreat did not confirm; new allocations deferred this cycle" });
    }
    return results;
  }

  for (const move of deploys) results.push(await runMove(move));
  return results;
}
