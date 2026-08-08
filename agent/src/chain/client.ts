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

export function makeClients(cfg: Config): Clients {
  const chain = makeChain(cfg);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });

  if (!cfg.agentPrivateKey) return { publicClient };

  const account = privateKeyToAccount(cfg.agentPrivateKey);
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  return { publicClient, walletClient, agentAddress: account.address };
}
