import { defineChain, parseAbi } from "viem";

// Flip the whole app to mainnet with NEXT_PUBLIC_CHAIN=mainnet plus the deployed
// pool address (NEXT_PUBLIC_POOL). Everything below keys off the active network.
const NET: "mainnet" | "testnet" =
  process.env.NEXT_PUBLIC_CHAIN === "mainnet" ? "mainnet" : "testnet";

export const xlayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://testrpc.xlayer.tech"] } },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer-test" },
  },
  testnet: true,
});

export const xlayerMainnet = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer" },
  },
});

export const activeChain = NET === "mainnet" ? xlayerMainnet : xlayerTestnet;
export const isMainnet = NET === "mainnet";

// Deployed addresses. Testnet defaults are the audited AumoPool redeploy; the
// mainnet pool address is set at launch via NEXT_PUBLIC_POOL (from DeployPoolMainnet).
const ADDR = {
  testnet: {
    pool: "0x057Caa4fC699bF830b8AE2E3B1f5D0D75eABd626",
    usdt0: "0xFc440733d882f28012B190b11Bbec56b44508448",
  },
  mainnet: {
    // Fill NEXT_PUBLIC_POOL after DeployPoolMainnet; USDT0 is the canonical X Layer address.
    pool: "0x0000000000000000000000000000000000000000",
    usdt0: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
  },
} as const;

export const POOL = (process.env.NEXT_PUBLIC_POOL ?? ADDR[NET].pool) as `0x${string}`;
export const USDT0 = (process.env.NEXT_PUBLIC_USDT0 ?? ADDR[NET].usdt0) as `0x${string}`;

// Guard the exact failure mode of the mainnet flip: NEXT_PUBLIC_CHAIN=mainnet set but
// NEXT_PUBLIC_POOL forgotten, so POOL falls back to the zero address and every read silently
// targets 0x0 (TVL renders "$0", deposits break). `poolConfigured` lets the UI show a loud
// notice instead of a plausible-looking empty pool.
export const poolConfigured =
  POOL !== "0x0000000000000000000000000000000000000000";
if (isMainnet && !poolConfigured) {
  console.error(
    "[aumo] NEXT_PUBLIC_POOL is not set on mainnet — pool reads target the zero address. Set it to the deployed AumoPool.",
  );
}

export const poolAbi = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function idleBalance() view returns (uint256)",
  "function totalDeployed() view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
