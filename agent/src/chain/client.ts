import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "../config.js";

export function makeChain(cfg: Config) {
  return defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

export interface Clients {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  agentAddress?: `0x${string}`;
}

export async function makeClients(cfg: Config): Promise<Clients> {
  const chain = makeChain(cfg);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  // Preferred: sign via Turnkey. The signing key never leaves Turnkey; the agent holds only an API
  // key that requests signatures, optionally restricted by a Turnkey policy to the pool contract.
  if (cfg.turnkey) {
    const { Turnkey } = await import("@turnkey/sdk-server");
    const { createAccount } = await import("@turnkey/viem");
    const tk = new Turnkey({
      apiBaseUrl: cfg.turnkey.baseUrl,
      apiPublicKey: cfg.turnkey.apiPublicKey,
      apiPrivateKey: cfg.turnkey.apiPrivateKey,
      defaultOrganizationId: cfg.turnkey.organizationId,
    });
    const account = await createAccount({
      client: tk.apiClient(),
      organizationId: cfg.turnkey.organizationId,
      signWith: cfg.turnkey.signWith,
    });
    const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
    return { publicClient, walletClient, agentAddress: account.address };
  }

  // Fallback (testnet only): a raw throwaway private key.
  if (!cfg.agentPrivateKey) return { publicClient };
  const account = privateKeyToAccount(cfg.agentPrivateKey);
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  return { publicClient, walletClient, agentAddress: account.address };
}
