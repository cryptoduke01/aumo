import { createPublicClient, http, parseAbi, type PublicClient, type Address } from "viem";

/**
 * Live market feed for an Aave v3 venue. Reads real reserve data on-chain and derives the
 * metrics the risk engine scores — supply APY, TVL, available exit liquidity, utilization —
 * instead of static config. On X Layer mainnet this makes the agent reason about the actual
 * market; the shape matches VenueMeta's market fields.
 */

const poolAbi = parseAbi([
  "struct ReserveConfigurationMap { uint256 data; }",
  "struct ReserveDataLegacy { ReserveConfigurationMap configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }",
  "function getReserveData(address asset) view returns (ReserveDataLegacy)",
]);

const erc20Abi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const RAY = 10n ** 27n;

export interface AaveMarket {
  apyBps: number; // supply APR in basis points (currentLiquidityRate)
  tvlUsd: number; // total supplied (underlying units, ~$1/USDT0)
  liquidityUsd: number; // underlying available in the aToken (immediately withdrawable)
  utilization: number; // 0..1 borrowed / supplied
  aToken: Address;
}

export async function readAaveMarket(
  pc: PublicClient,
  pool: Address,
  underlying: Address,
): Promise<AaveMarket> {
  const rd = await pc.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "getReserveData",
    args: [underlying],
  });

  const aToken = rd.aTokenAddress;
  const variableDebt = rd.variableDebtTokenAddress;

  const [decimals, tvl, avail, debt] = await Promise.all([
    pc.readContract({ address: underlying, abi: erc20Abi, functionName: "decimals" }),
    pc.readContract({ address: aToken, abi: erc20Abi, functionName: "totalSupply" }),
    pc.readContract({ address: underlying, abi: erc20Abi, functionName: "balanceOf", args: [aToken] }),
    pc.readContract({ address: variableDebt, abi: erc20Abi, functionName: "totalSupply" }),
  ]);

  const unit = 10 ** Number(decimals);
  // currentLiquidityRate is a per-year rate in ray. bps = rate / 1e27 * 10000 = rate / 1e23.
  const apyBps = Number((rd.currentLiquidityRate * 10000n) / (RAY / 100n)) / 100;
  const tvlUsd = Number(tvl) / unit;
  const liquidityUsd = Number(avail) / unit;
  const utilization = tvl > 0n ? Number(debt) / Number(tvl) : 0;

  return {
    apyBps: Math.round(apyBps),
    tvlUsd,
    liquidityUsd,
    utilization: Math.max(0, Math.min(1, utilization)),
    aToken,
  };
}

/** Convenience for a one-off read against a given RPC. */
export async function readAaveMarketAt(
  rpcUrl: string,
  pool: Address,
  underlying: Address,
): Promise<AaveMarket> {
  const pc = createPublicClient({ transport: http(rpcUrl) });
  return readAaveMarket(pc, pool, underlying);
}
