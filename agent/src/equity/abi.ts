import { parseAbi } from "viem";

/**
 * EquityPool — the opt-in, at-risk equity pool. Superset of the AumoPool surface the agent reads,
 * plus `marketOpen()` (the market-hours gate) and `setMarketClock` (owner-only, not used by the
 * executor). The executor only ever calls `allocate` here (deploy idle into the single xStock
 * venue); the contract re-checks every guardrail, so a bug in the executor can at worst revert.
 */
export const equityPoolAbi = parseAbi([
  "function asset() view returns (address)",
  "function agent() view returns (address)",
  "function paused() view returns (bool)",
  "function marketOpen() view returns (bool)",
  "function idleBalance() view returns (uint256)",
  "function totalDeployed() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function maxMoveSize() view returns (uint256)",
  "function perVenueCap() view returns (uint256)",
  "function maxTotalDeployed() view returns (uint256)",
  "function allocated(address) view returns (uint256)",
  "function venueAllowed(address) view returns (bool)",
  "function venueBalance(address) view returns (uint256)",
  "function allocate(address venue, uint256 amount, bytes32 reason)",
  "function deallocate(address venue, uint256 amount)",
]);

/** MockEquityOracle — testnet only. `set` writes a price (WAD) and publish time for a feed id. */
export const mockOracleAbi = parseAbi([
  "function set(bytes32 id, uint256 priceWad, uint256 updatedAt)",
  "function priceWad(bytes32 id) view returns (uint256 price, uint256 updatedAt)",
]);

/** MockSwapRouter — testnet only. `setPrice` moves the pool price so a swap fills near the oracle. */
export const mockRouterAbi = parseAbi([
  "function setPrice(uint256 poolPriceWad)",
  "function poolPriceWad() view returns (uint256)",
]);
