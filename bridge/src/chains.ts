export type Address = `0x${string}`;

export interface OftChain {
  key: string;
  name: string;
  chainId: number;
  eid: number; // LayerZero endpoint id
  oft: Address; // USDT0 OFT (send/quoteSend live here)
  rpc: string;
}

/** X Layer is always the destination for Aumo deposits. */
export const XLAYER_EID = 30274;
export const XLAYER_USDT0: Address = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";

/**
 * USDT0 LayerZero OFT registry, from docs.usdt0.to/deployments, OFT addresses verified
 * on-chain. The OFT is where quoteSend / send are called; the underlying token is read
 * from the OFT at runtime so we never hardcode it wrong.
 */
export const CHAINS: Record<string, OftChain> = {
  ethereum: {
    key: "ethereum",
    name: "Ethereum",
    chainId: 1,
    eid: 30101,
    oft: "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee",
    rpc: "https://eth.llamarpc.com",
  },
  arbitrum: {
    key: "arbitrum",
    name: "Arbitrum One",
    chainId: 42161,
    eid: 30110,
    oft: "0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92",
    rpc: "https://arb1.arbitrum.io/rpc",
  },
  optimism: {
    key: "optimism",
    name: "Optimism",
    chainId: 10,
    eid: 30111,
    oft: "0xF03b4d9AC1D5d1E7c4cEf54C2A313b9fe051A0aD",
    rpc: "https://mainnet.optimism.io",
  },
  polygon: {
    key: "polygon",
    name: "Polygon PoS",
    chainId: 137,
    eid: 30109,
    oft: "0x6BA10300f0DC58B7a1e4c0e41f5daBb7D7829e13",
    rpc: "https://polygon-rpc.com",
  },
};

export function resolveChain(key: string): OftChain {
  const c = CHAINS[key.toLowerCase()];
  if (!c) {
    throw new Error(
      `unknown source chain "${key}". Options: ${Object.keys(CHAINS).join(", ")}`,
    );
  }
  return c;
}
