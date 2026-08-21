// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {UniV3LpAdapter} from "../src/adapters/UniV3LpAdapter.sol";

/// @notice Add the full-range USDG/USDT0 Uniswap-v3 LP venue to the ALREADY-DEPLOYED mainnet pool
///         (chainId 196). Deploys only the adapter (the pool already exists) and, if the broadcaster
///         is the pool owner, allowlists it in the same transaction. If the pool is owned by a Safe,
///         the adapter is deployed and the exact `setVenueAllowed` calldata is printed for the Safe
///         to execute. The per-venue / total caps and loss/deploy budgets already set on the pool
///         apply to the new venue automatically; no policy change is needed to go live conservatively.
///
/// Real X Layer mainnet addresses (verified on-chain):
///   USDT0 (asset, 6dp)        0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   USDG (RWA-backed, 6dp)    0x4ae46a509F6b1D9056937BA4500cb143933D2dc8
///   USDG/USDT0 v3 pool 0.01%  0x0cBe0dBE1400e57f371a38BD3b9bC80F7C3676dA  (token0=USDG, tickSpacing 1)
///   SwapRouter02              0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA
///
/// Usage (spends real gas; broadcaster should be the pool owner EOA, or use a Safe and execute the
/// printed calldata there):
///   POOL=0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F \
///   forge script script/AddLpVenueMainnet.s.sol:AddLpVenueMainnet \
///     --rpc-url https://rpc.xlayer.tech --private-key "$PRIVATE_KEY" --broadcast
///
/// Optional env: SAFE (adapter owner, defaults to the pool owner), LP_SLIPPAGE_BPS (default 200 = 2%),
/// LP_VALUATION_BPS (default 50 = 0.5% NAV haircut).
contract AddLpVenueMainnet is Script {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant LP_POOL = 0x0cBe0dBE1400e57f371a38BD3b9bC80F7C3676dA; // USDG/USDT0 0.01%
    address constant UNI_ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA; // SwapRouter02
    uint24 constant LP_FEE = 100; // 0.01% tier

    function run() external {
        require(block.chainid == 196, "not X Layer mainnet");

        AumoPool pool = AumoPool(vm.envAddress("POOL"));
        address poolOwner = pool.owner();
        // The adapter owner (retunes slippage, emergency exit) is the Safe if given, else the pool owner.
        address adapterOwner = vm.envOr("SAFE", poolOwner);
        uint256 slippageBps = vm.envOr("LP_SLIPPAGE_BPS", uint256(200));
        uint256 valuationBps = vm.envOr("LP_VALUATION_BPS", uint256(50));

        vm.startBroadcast();
        // Constructor pins the pool to exactly USDG/USDT0 with tickSpacing 1 and equal decimals; a
        // wrong LP_POOL reverts the deploy rather than shipping a mis-wired venue.
        UniV3LpAdapter lp = new UniV3LpAdapter(
            USDT0, USDG, LP_POOL, UNI_ROUTER, address(pool), adapterOwner, LP_FEE, slippageBps, valuationBps
        );

        bool allowlistedNow = false;
        if (msg.sender == poolOwner) {
            pool.setVenueAllowed(address(lp), true);
            allowlistedNow = true;
        }
        vm.stopBroadcast();

        console2.log("UniV3LpAdapter deployed:", address(lp));
        console2.log("AumoPool:               ", address(pool));
        console2.log("pool owner:             ", poolOwner);
        console2.log("adapter owner:          ", adapterOwner);
        console2.log("slippage floor bps:     ", slippageBps);
        console2.log("NAV discount bps:       ", valuationBps);
        if (allowlistedNow) {
            console2.log("ALLOWLISTED: setVenueAllowed(adapter, true) sent. Venue is live under existing caps.");
        } else {
            console2.log("NOT allowlisted (broadcaster != pool owner). Execute this on the owner/Safe:");
            console2.log("  target:", address(pool));
            console2.logBytes(abi.encodeCall(AumoPool.setVenueAllowed, (address(lp), true)));
        }
        console2.log("Next: add the adapter address to agent config/venues.mainnet.json to let the agent allocate.");
    }
}
