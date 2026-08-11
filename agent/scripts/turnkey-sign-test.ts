/** Prove Turnkey can sign for the agent account: build the viem account and sign a test message.
 *  No transaction is broadcast and no funds move. */
import { Turnkey } from "@turnkey/sdk-server";
import { createAccount } from "@turnkey/viem";

async function main() {
  const tk = new Turnkey({
    apiBaseUrl: process.env.TURNKEY_BASE_URL ?? "https://api.turnkey.com",
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
  });
  const account = await createAccount({
    client: tk.apiClient(),
    organizationId: process.env.TURNKEY_ORGANIZATION_ID!,
    signWith: process.env.TURNKEY_SIGN_WITH!,
  });
  console.log("account address:", account.address);
  const sig = await account.signMessage({ message: "aumo turnkey signer check" });
  console.log("signed via Turnkey:", sig.slice(0, 24) + "…", `(len ${sig.length})`);
  console.log("✅ Turnkey holds the key and can sign for this address.");
}

main().catch((e) => {
  console.error("sign test failed:", e?.message ?? e);
  process.exit(1);
});
