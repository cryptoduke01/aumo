import { defineChain, parseAbi } from "viem";

// Flip the whole app to mainnet with NEXT_PUBLIC_CHAIN=mainnet plus the deployed
// pool address (NEXT_PUBLIC_POOL). Everything below keys off the active network.
// Mainnet is the default now that Aumo is live on X Layer. Local dev stays on testnet via
// NEXT_PUBLIC_CHAIN=testnet in web/.env.local; set it in any env that should point at testnet.
const NET: "mainnet" | "testnet" =
  process.env.NEXT_PUBLIC_CHAIN === "testnet" ? "testnet" : "mainnet";

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

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// Deployed addresses. Testnet defaults are the audited AumoPool redeploy; the
// mainnet pool address is set at launch via NEXT_PUBLIC_POOL (from DeployPoolMainnet).
const ADDR = {
  testnet: {
    // AumoPool redeployed from the fixed source (loss/deploy budgets, impairment, redemption
    // isolation). Supersedes the pre-fix 0x057C…d626. Deployed 2026-08-10.
    pool: "0x9A972bEeA00C6f2D76781586eAbd0c16e9b6d360",
    usdt0: "0xFc440733d882f28012B190b11Bbec56b44508448",
    usdg: ZERO, // no testnet USDG; the USDG deposit zap is a mainnet feature
    zap: ZERO,
  },
  mainnet: {
    // Deployed 2026-08-13 (DeployPoolMainnet, chain 196). USDT0 is the canonical X Layer address.
    pool: "0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F",
    usdt0: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
    usdg: "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8", // Global Dollar (USDG), 94% of X Layer stables
    zap: "0x29C9D4e86E587F42dadDa0b8004181EFE2D8B3df", // ZapDeposit, deployed 2026-08-22
  },
} as const;

export const POOL = (process.env.NEXT_PUBLIC_POOL ?? ADDR[NET].pool) as `0x${string}`;
export const USDT0 = (process.env.NEXT_PUBLIC_USDT0 ?? ADDR[NET].usdt0) as `0x${string}`;
export const USDG = (process.env.NEXT_PUBLIC_USDG ?? ADDR[NET].usdg) as `0x${string}`;
// The USDG->USDT0->deposit zap. Set NEXT_PUBLIC_ZAP after deploying ZapDeposit; until then the USDG
// deposit option is hidden and the app behaves exactly as before (USDT0-only).
export const ZAP = (process.env.NEXT_PUBLIC_ZAP ?? ADDR[NET].zap) as `0x${string}`;
// The USDG/USDT0 pool fee tier (0.01%), used by the zap swap and to quote the minimum out.
export const USDG_POOL_FEE = 100;
export const zapConfigured = ZAP !== ZERO && USDG !== ZERO;

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

// --- Opt-in, AT-RISK tokenized-stock pools. Each stock is its OWN pool (one pool == one stock) so
// positions are priced by their own feed and never entangled — never mixed with the safe pool. The
// catalog is the target menu; the real availability is the intersection of Chainlink Data Streams
// equity feeds and X Layer xStock liquidity. A stock with a zero `pool` on the active network renders
// as "coming soon"; on testnet the first stock points at the live soak deploy so the surface is real.
const ZERO32 = ("0x" + "00".repeat(32)) as `0x${string}`;

export interface StockConfig {
  symbol: string; // xStock ticker (e.g. NVDAx)
  name: string; // company (e.g. NVIDIA)
  feedId: `0x${string}`; // Data Streams feed id (bytes32)
  pool: `0x${string}`; // the at-risk pool for this stock
  oracle: `0x${string}`; // the equity oracle backing it
  stock: `0x${string}`; // the xStock token
}

const soon = (symbol: string, name: string): StockConfig => ({
  symbol,
  name,
  feedId: ZERO32,
  pool: ZERO,
  oracle: ZERO,
  stock: ZERO,
});

// The target catalog. NVDAx is live on testnet (the soak deploy); the rest list as coming soon until
// each one's pool is deployed. Final availability tracks Chainlink's equity streams + xStock liquidity.
const STOCKS_BY_NET: Record<"mainnet" | "testnet", StockConfig[]> = {
  testnet: [
    {
      symbol: "NVDAx",
      name: "NVIDIA",
      feedId: "0x4e56444100000000000000000000000000000000000000000000000000000000",
      pool: "0x912C2916e1284C5874692a611Dc8F9a7b5198eA4",
      oracle: "0xA1e12A539dC6698De9a6a073E3e33b78B3bbD82B",
      stock: "0xe18b3545be348a2a8da69Fe77Fa611E76759B305",
    },
    soon("TSLAx", "Tesla"),
    soon("AAPLx", "Apple"),
    soon("MSFTx", "Microsoft"),
    soon("AMZNx", "Amazon"),
    soon("METAx", "Meta"),
    soon("GOOGLx", "Alphabet"),
    soon("COINx", "Coinbase"),
  ],
  mainnet: [
    soon("NVDAx", "NVIDIA"),
    soon("TSLAx", "Tesla"),
    soon("AAPLx", "Apple"),
    soon("MSFTx", "Microsoft"),
    soon("AMZNx", "Amazon"),
    soon("METAx", "Meta"),
    soon("GOOGLx", "Alphabet"),
    soon("COINx", "Coinbase"),
  ],
};

export const STOCKS = STOCKS_BY_NET[NET];
export const liveStocks = STOCKS.filter((s) => s.pool !== ZERO);

// The equity pool's surface: the safe-pool reads plus the market-hours gate. Kept distinct from
// poolAbi so the at-risk pool can never be driven through the safe-pool code paths by accident.
export const equityPoolAbi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function idleBalance() view returns (uint256)",
  "function marketOpen() view returns (bool)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

export const equityOracleAbi = parseAbi([
  "function priceWad(bytes32 feedId) view returns (uint256 price, uint256 updatedAt)",
]);

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
  "function venueBalance(address) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function riskAppetiteOf(address) view returns (uint8)",
  "function setRiskAppetite(uint8 tier)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const zapAbi = parseAbi([
  "function zapDeposit(address tokenIn, uint24 fee, uint256 amountIn, uint256 minUsdt0Out, address receiver) returns (uint256)",
]);
