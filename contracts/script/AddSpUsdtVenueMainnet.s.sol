// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {Erc4626Adapter} from "../src/adapters/Erc4626Adapter.sol";

/// @notice Add the Spark Savings USDT (spUSDT) venue to the ALREADY-DEPLOYED mainnet pool
///         (chainId 196). Deploys only the adapter (the pool already exists) and, if the broadcaster
///         is the pool owner, allowlists it in the same transaction. If the pool is owned by a Safe,
///         the adapter is deployed and the exact `setVenueAllowed` calldata is printed for the Safe
///         to execute. The per-venue / total caps and loss/deploy budgets already on the pool apply
///         to the new venue automatically; no policy change is needed to go live conservatively.
///
/// Real X Layer mainnet addresses (verified on-chain 2026-09-11):
///   USDT0 (asset, 6dp)       0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   spUSDT (ERC-4626, 6dp)   0xc358c90D32375721Cb3924320Fdc2F8B694347Ca  (asset() == USDT0)
///
/// Usage (spends real gas; broadcaster should be the pool owner EOA, or use a Safe and execute the
/// printed calldata there):
///   POOL=0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F \
///   forge script script/AddSpUsdtVenueMainnet.s.sol:AddSpUsdtVenueMainnet \
///     --rpc-url https://rpc.xlayer.tech --private-key "$PRIVATE_KEY" --broadcast
contract AddSpUsdtVenueMainnet is Script {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant SPUSDT = 0xc358c90D32375721Cb3924320Fdc2F8B694347Ca;

    function run() external {
        require(block.chainid == 196, "not X Layer mainnet");

        AumoPool pool = AumoPool(vm.envAddress("POOL"));
        address poolOwner = pool.owner();

        vm.startBroadcast();
        // Constructor asserts spUSDT.asset() == USDT0; a wrong venue reverts the deploy rather than
        // shipping a mis-wired adapter.
        Erc4626Adapter adapter = new Erc4626Adapter(USDT0, SPUSDT, address(pool));

        bool allowlistedNow = false;
        if (msg.sender == poolOwner) {
            pool.setVenueAllowed(address(adapter), true);
            allowlistedNow = true;
        }
        vm.stopBroadcast();

        console2.log("Erc4626Adapter (spUSDT) deployed:", address(adapter));
        console2.log("AumoPool:                        ", address(pool));
        console2.log("pool owner:                      ", poolOwner);
        if (allowlistedNow) {
            console2.log("ALLOWLISTED: setVenueAllowed(adapter, true) sent. Venue is live under existing caps.");
        } else {
            console2.log("NOT allowlisted (broadcaster != pool owner). Execute this on the owner/Safe:");
            console2.log("  target:", address(pool));
            console2.logBytes(abi.encodeCall(AumoPool.setVenueAllowed, (address(adapter), true)));
        }
        console2.log("Next: add the adapter address to agent config/venues.mainnet.json to let the agent allocate.");
    }
}
