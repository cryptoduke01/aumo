/** Read-only: list the wallets + ETH accounts in the Turnkey org, and check for a target address. */
import { Turnkey } from "@turnkey/sdk-server";

const target = (process.env.TURNKEY_SIGN_WITH ?? "").toLowerCase();

async function main() {
  const tk = new Turnkey({
    apiBaseUrl: process.env.TURNKEY_BASE_URL ?? "https://api.turnkey.com",
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
  });
  const client = tk.apiClient();

  const { wallets } = await client.getWallets();
  console.log(`wallets: ${wallets.length}`);
  const found: string[] = [];
  for (const w of wallets) {
    const { accounts } = await client.getWalletAccounts({ walletId: w.walletId });
    const eth = accounts.filter((a) => (a.addressFormat ?? "").includes("ETHEREUM"));
    console.log(`  wallet "${w.walletName}" (${w.walletId}) — ${eth.length} ETH account(s):`);
    for (const a of eth) {
      console.log(`    ${a.address}`);
      found.push(a.address.toLowerCase());
    }
  }
  console.log("");
  if (!target) {
    console.log("No TURNKEY_SIGN_WITH set to check.");
  } else if (found.includes(target)) {
    console.log(`✅ ${target} IS a Turnkey account — safe to use as the agent signer.`);
  } else {
    console.log(`❌ ${target} is NOT in this Turnkey org. It cannot be used as the signer.`);
    console.log(`   Use one of the addresses listed above, or create a new Ethereum wallet/account in Turnkey.`);
  }
}

main().catch((e) => {
  console.error("Turnkey query failed:", e?.message ?? e);
  process.exit(1);
});
