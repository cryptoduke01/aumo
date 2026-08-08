// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AumoVault} from "../src/AumoVault.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockVenueAdapter} from "../test/mocks/MockVenueAdapter.sol";

/// @notice Full X Layer TESTNET deployment. Testnet has no real USDT0 / Aave / STBL, so this
///         stands up a mock USDT0 and a mock yield venue to prove the end-to-end flow live
///         on-chain (deposit -> allocate -> receipts). Real venues plug in on mainnet.
///
/// The broadcaster MUST equal VAULT_OWNER — the owner-only setup runs in the same broadcast.
///
///   forge script script/DeployTestnet.s.sol:DeployTestnet \
///     --rpc-url $XLAYER_TESTNET_RPC --private-key $PRIVATE_KEY --broadcast
contract DeployTestnet is Script {
    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        uint256 maxMove = vm.envOr("MAX_MOVE", uint256(100_000_000)); // 100 USDT0
        uint256 perVenueCap = vm.envOr("PER_VENUE_CAP", uint256(500_000_000)); // 500 USDT0
        uint256 maxTotal = vm.envOr("MAX_TOTAL", uint256(1_000_000_000)); // 1000 USDT0

        vm.startBroadcast();

        MockERC20 usdt0 = new MockERC20("Test USDT0", "USDT0", 6);
        usdt0.mint(owner, 10_000_000_000); // 10,000 test USDT0 to play with

        AumoVault vault = new AumoVault(address(usdt0), owner);
        MockVenueAdapter venue = new MockVenueAdapter(address(usdt0));

        vault.setVenueAllowed(address(venue), true);
        vault.setPolicy(maxMove, perVenueCap, maxTotal);
        vault.setAgent(owner); // owner doubles as the agent on testnet for the demo

        vm.stopBroadcast();

        console2.log("Test USDT0:    ", address(usdt0));
        console2.log("AumoVault:     ", address(vault));
        console2.log("MockVenue:     ", address(venue));
        console2.log("owner / agent: ", owner);
    }
}
