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

  // Split the plan into pure retreats, idle deploys, and rotation legs. Rotations are paired: the
  // planner tags both legs `rebalance`, and they are emitted out-leg then in-leg, so they pair 1:1
  // by order.
  const pureRetreats = plan.moves.filter((m) => m.action === "deallocate" && !m.rebalance);
  const deploys = plan.moves.filter((m) => m.action === "allocate" && !m.rebalance);
  const rotOuts = plan.moves.filter((m) => m.action === "deallocate" && m.rebalance);
  const rotIns = plan.moves.filter((m) => m.action === "allocate" && m.rebalance);

  // 1) Pure retreats first — always reduce risk before adding any exposure.
  for (const move of pureRetreats) results.push(await runMove(move));

  // De-risk-first invariant: if any retreat did not confirm, do NOT add or move exposure this cycle.
  // That means deferring the idle deploys AND the rotations (both legs) — pulling from a healthy
  // venue while still stuck exiting a bad one is exactly the wrong move under the stress that
  // triggers a retreat. Recorded honestly as skipped; nothing is left half-done.
  if (results.some((r) => r.status !== "confirmed")) {
    for (const move of [...deploys, ...rotOuts, ...rotIns]) {
      results.push({ move, status: "skipped", error: "retreat did not confirm; new exposure deferred this cycle" });
    }
    return results;
  }

  // 2) Idle deploys.
  for (const move of deploys) results.push(await runMove(move));

  // 3) Rotations, executed as an ATOMIC pair: run each out-leg, and only run its paired in-leg if
  //    that out-leg confirmed. A rotation-in can therefore never fire without its own funding
  //    out-leg, and an unrelated move's failure can never strand a rotation half-done in idle — which
  //    is precisely the depeg-stress scenario where the old shared retreat/deploy split broke.
  for (let i = 0; i < rotOuts.length; i++) {
    const outMove = rotOuts[i];
    if (!outMove) continue;
    const out = await runMove(outMove);
    results.push(out);
    const inLeg = rotIns[i];
    if (!inLeg) continue;
    if (out.status === "confirmed") {
      results.push(await runMove(inLeg));
    } else {
      results.push({ move: inLeg, status: "skipped", error: "rotation out-leg did not confirm; paired in-leg skipped" });
    }
  }
  return results;
}
