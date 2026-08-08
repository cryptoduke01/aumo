import { parseAbi } from "viem";

/** AumoVault — only the surface the agent reads and calls. */
export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function maxMoveSize() view returns (uint256)",
  "function perVenueCap() view returns (uint256)",
  "function maxTotalDeployed() view returns (uint256)",
  "function totalDeployed() view returns (uint256)",
  "function allocated(address) view returns (uint256)",
  "function venueAllowed(address) view returns (bool)",
  "function idleBalance() view returns (uint256)",
  "function venueBalance(address) view returns (uint256)",
  "function paused() view returns (bool)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function allocate(address venue, uint256 amount, bytes32 reason)",
  "function deallocate(address venue, uint256 amount)",
  "event Allocated(address indexed venue, uint256 amount, bytes32 reason, uint256 timestamp)",
  "event Deallocated(address indexed venue, uint256 principal, uint256 returned, uint256 timestamp)",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);
