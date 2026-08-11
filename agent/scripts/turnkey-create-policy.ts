/**
 * Apply the Aumo agent signing policy (see agent/turnkey/SIGNING-POLICY.md). Restricts the agent's
 * Turnkey key to signing only allocate/deallocate to the Aumo pool on X Layer mainnet, zero value.
 * Run at mainnet deploy with an admin/root API key; the agent then runs with the restricted non-root
 * key this policy governs. Requires: AUMO_POOL, TURNKEY_AGENT_USER_ID, and the TURNKEY_* creds.
 */
import { Turnkey } from "@turnkey/sdk-server";

const ALLOCATE = "0x55be7f73"; // allocate(address,uint256,bytes32)
const DEALLOCATE = "0x59db9eb0"; // deallocate(address,uint256)

async function main() {
  const pool = (process.env.AUMO_POOL ?? "").toLowerCase();
  const agentUserId = process.env.TURNKEY_AGENT_USER_ID ?? "";
  const chainId = process.env.AUMO_CHAIN_ID ?? "196";
  if (!/^0x[0-9a-f]{40}$/.test(pool)) throw new Error("set AUMO_POOL to the mainnet pool address");
  if (!agentUserId) throw new Error("set TURNKEY_AGENT_USER_ID to the agent's non-root user id");

  const condition =
    `activity.action == 'SIGN' && eth.tx.chain_id == ${chainId} && ` +
    `eth.tx.to == '${pool}' && eth.tx.value == 0 && ` +
    `(eth.tx.function_signature == '${ALLOCATE}' || eth.tx.function_signature == '${DEALLOCATE}')`;

  const tk = new Turnkey({
    apiBaseUrl: process.env.TURNKEY_BASE_URL ?? "https://api.turnkey.com",
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
  });

  const res = await tk.apiClient().createPolicy({
    policyName: "aumo-agent-signer-restrict-to-pool",
    effect: "EFFECT_ALLOW",
    consensus: `approvers.any(user, user.id == '${agentUserId}')`,
    condition,
    notes:
      "Agent signer may only sign X Layer mainnet transactions to the Aumo pool, calling " +
      "allocate/deallocate, with zero native value. Everything else is denied.",
  });

  console.log("policyId:", res.policyId);
  console.log("condition:", condition);
}

main().catch((e) => {
  console.error("createPolicy failed:", e?.message ?? e);
  process.exit(1);
});
