/** Create a Turnkey-held Ethereum wallet for the agent signer. The private key is generated and kept
 *  inside Turnkey; we only ever receive the address. Prints the new signer address. */
import { Turnkey } from "@turnkey/sdk-server";

async function main() {
  const tk = new Turnkey({
    apiBaseUrl: process.env.TURNKEY_BASE_URL ?? "https://api.turnkey.com",
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
  });
  const client = tk.apiClient();

  const resp = await client.createWallet({
    walletName: "Aumo Agent Signer",
    accounts: [
      {
        curve: "CURVE_SECP256K1",
        pathFormat: "PATH_FORMAT_BIP32",
        path: "m/44'/60'/0'/0/0",
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
      },
    ],
  });

  console.log("walletId:", resp.walletId);
  console.log("SIGN_WITH (agent address):", resp.addresses[0]);
}

main().catch((e) => {
  console.error("createWallet failed:", e?.message ?? e);
  process.exit(1);
});
