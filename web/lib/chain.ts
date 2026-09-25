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
// catalog is the target menu; real availability tracks X Layer xStock liquidity (pricing is a
// self-hosted oracle Aumo runs). A stock with a zero `pool` on the active network renders as "coming
// soon"; on testnet the first stock points at the live soak deploy so the surface is real.
const ZERO32 = ("0x" + "00".repeat(32)) as `0x${string}`;

export interface StockConfig {
  symbol: string; // xStock ticker (e.g. NVDAx)
  name: string; // company (e.g. NVIDIA)
  feedId: `0x${string}`; // oracle feed id, bytes32(symbol)
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
  // Live on X Layer mainnet — HARDENED REDEPLOY 2026-09-21 (anti-dilution levy 25/50 bps, 5-min
  // staleness window, future-dated-observation clamp). Each stock is its own pool, all priced by the
  // shared self-hosted oracle 0x1759. `stock` is the WRAPPED xStock (w<SYM>x) carrying the Uniswap
  // liquidity the adapter routes through. Supersedes the pre-hardening pools (0x42ee/0xD66a/0xEE9C/0xC708).
  mainnet: [
    {
      symbol: "NVDAx",
      name: "NVIDIA",
      feedId: "0x4e56444100000000000000000000000000000000000000000000000000000000",
      pool: "0x9781cD1f02045c072D7D1915a215c9E46b49E1dB",
      oracle: "0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2",
      stock: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5",
    },
    {
      symbol: "AAPLx",
      name: "Apple",
      feedId: "0x4141504c00000000000000000000000000000000000000000000000000000000",
      pool: "0xDcd9c0C948ebb4D63d88FA5EC8eDE571eF1BE523",
      oracle: "0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2",
      stock: "0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f",
    },
    {
      symbol: "MSFTx",
      name: "Microsoft",
      feedId: "0x4d53465400000000000000000000000000000000000000000000000000000000",
      pool: "0xbe0A87F49F424D3170804e29E5969a379Fe65626",
      oracle: "0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2",
      stock: "0x166Fbe68274b6a47e025F4ba17388c539f1fa1d0",
    },
    {
      symbol: "METAx",
      name: "Meta",
      feedId: "0x4d45544100000000000000000000000000000000000000000000000000000000",
      pool: "0x47343D8a880c84aD1a6aD679FEdd0DC23fdA8BcC",
      oracle: "0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2",
      stock: "0xe840946FfEBCd66B7C4E95095effaFaDfa0D0e56",
    },
    soon("TSLAx", "Tesla"),
    soon("AMZNx", "Amazon"),
    soon("GOOGLx", "Alphabet"),
    soon("COINx", "Coinbase"),
  ],
};

export const STOCKS = STOCKS_BY_NET[NET];
export const liveStocks = STOCKS.filter((s) => s.pool !== ZERO);

// --- The DIVERSIFIED BASKET: ONE EquityPool holding an equal-weight basket of stocks via N adapters.
// The agent only maintains equal weight (rebalances on drift); it does not time or pick. Diversification
// is the cycle-proven drawdown reducer (~43% single-name -> ~32% basket over 5y incl. the 2022 bear).
export interface BasketMember {
  symbol: string; // xStock ticker, e.g. NVDAx
  name: string; // company
  venue: `0x${string}`; // the allowlisted EquityAdapter for this stock in the basket pool
}
export interface BasketConfig {
  pool: `0x${string}`; // the basket EquityPool (ERC-4626, USDT0 in, aumoEQTY shares out)
  oracle: `0x${string}`;
  members: BasketMember[];
}

const BASKET_BY_NET: Record<"mainnet" | "testnet", BasketConfig | null> = {
  testnet: null,
  // HARDENED REDEPLOY 2026-09-21 (DeployBasketMainnet, chain 196): anti-dilution levy 25/50 bps,
  // 5-min staleness, obs-clamp. Reuses the shared self-hosted oracle 0x1759. Supersedes 0x39Ce.
  mainnet: {
    pool: "0xFe01b81F5D22Ac3647424904f7DC7ecC9EA0358d",
    oracle: "0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2",
    members: [
      { symbol: "NVDAx", name: "NVIDIA", venue: "0xfdf7eb2a1A4F734901efB03a6a026dBb17B1A3dC" },
      { symbol: "AAPLx", name: "Apple", venue: "0x479e1A2B6A2B70599a3Ef3e89334cb2dcAf43f63" },
      { symbol: "MSFTx", name: "Microsoft", venue: "0x5908B1143d69f363FEEc8bBc41cb73Ff26C8de40" },
      { symbol: "METAx", name: "Meta", venue: "0xFC0F4b0C9C0CF785f822079EbFb789Dbeb7DdF49" },
    ],
  },
};
export const BASKET = BASKET_BY_NET[NET];

// --- GOLD: an opt-in, at-risk pool holding PAXGy (Paxos yield-bearing tokenized gold). Same isolated,
// levy-hardened EquityPool as the stocks; NOT the safe pool (gold's USD value moves). Priced by the
// shared self-hosted oracle, where the feeder posts a PAXGY price = on-chain getRate() x gold/USD.
// Deployed 2026-09-25 (DeployGoldMainnet, chain 196).
export interface GoldConfig {
  symbol: string; // PAXGy
  name: string; // PAX Gold
  feedId: `0x${string}`;
  pool: `0x${string}`;
  adapter: `0x${string}`;
  oracle: `0x${string}`;
  stock: `0x${string}`; // the PAXGy token
}
const GOLD_BY_NET: Record<"mainnet" | "testnet", GoldConfig | null> = {
  testnet: null,
  mainnet: {
    symbol: "PAXGy",
    name: "PAX Gold",
    feedId: "0x5041584759000000000000000000000000000000000000000000000000000000",
    pool: "0xf1833C4eAEb42df6D9eE33ea090055cf690cee56",
    adapter: "0x6c3Dca1AA96010683bB0e7A0AEb80AbC2e4c25bF",
    oracle: "0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2",
    stock: "0x6c6494Fd9962eB98B94ffA48F6679058F820700e",
  },
};
export const GOLD = GOLD_BY_NET[NET];

// The equity pool's surface: the safe-pool reads plus the market-hours gate. Kept distinct from
// poolAbi so the at-risk pool can never be driven through the safe-pool code paths by accident.
export const equityPoolAbi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function maxRedeem(address) view returns (uint256)",
  "function idleBalance() view returns (uint256)",
  "function venueBalance(address) view returns (uint256)",
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
