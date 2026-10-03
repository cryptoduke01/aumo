import { defineChain, type Address } from "viem";

// Single place for every network constant the MCP server uses. The addresses are the X Layer
// mainnet deployment the web app reads (web/lib/chain.ts, ADDR.mainnet) and the DefiLlama adapter
// counts (integrations/defillama/index.js). Do not edit them here without updating those first.

export const CHAIN_ID = 196 as const;

export const POOL: Address = "0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F"; // AumoPool (ERC-4626)
export const USDT0: Address = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736"; // pool asset

// The pool asset (USDT0) is 6 decimals. The agent's own server makes the same assumption when it
// reads a depositor's position (agent/src/server.ts, readYou). Pool shares are read on-chain.
export const ASSET_DECIMALS = 6;
export const ASSET_SYMBOL = "USDT0";

export const DEFAULT_AGENT_URL = "https://aumo-production.up.railway.app";
export const DEFAULT_RPC_URL = "https://rpc.xlayer.tech";
export const EXPLORER = "https://www.oklink.com/xlayer";

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (addr: string) => `${EXPLORER}/address/${addr}`;

export function xlayer(rpcUrl: string) {
  return defineChain({
    id: CHAIN_ID,
    name: "X Layer",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "OKLink", url: EXPLORER } },
  });
}

export interface Settings {
  agentUrl: string;
  rpcUrl: string;
}

/** Env-driven settings. Only public endpoints: this server never reads or needs a key. */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const strip = (s: string) => s.replace(/\/+$/, "");
  return {
    agentUrl: strip(env.AGENT_URL?.trim() || DEFAULT_AGENT_URL),
    rpcUrl: env.RPC_URL?.trim() || DEFAULT_RPC_URL,
  };
}
