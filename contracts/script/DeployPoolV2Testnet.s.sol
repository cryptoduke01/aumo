// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {MockVenueAdapter} from "../test/mocks/MockVenueAdapter.sol";

/// @notice Redeploy the audited AumoPool to X Layer testnet with TWO venues, so the risk engine
///         chooses between them. Reuses the existing test USDT0. Broadcaster must be VAULT_OWNER.
contract DeployPoolV2Testnet is Script {
    address constant TEST_USDT0 = 0xFc440733d882f28012B190b11Bbec56b44508448;

    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");

        vm.startBroadcast();
        AumoPool pool = new AumoPool(IERC20(TEST_USDT0), owner);
        MockVenueAdapter venueA = new MockVenueAdapter(TEST_USDT0); // MockYield (higher yield/risk)
        MockVenueAdapter venueB = new MockVenueAdapter(TEST_USDT0); // StableVault (lower yield/risk)

        pool.setVenueAllowed(address(venueA), true);
        pool.setVenueAllowed(address(venueB), true);
        pool.setPolicy(200e6, 800e6, 2000e6); // maxMove, perVenueCap, maxTotalDeployed
        vm.stopBroadcast();

        console2.log("AumoPool (audited):", address(pool));
        console2.log("venueA MockYield:  ", address(venueA));
        console2.log("venueB StableVault:", address(venueB));
        console2.log("owner/agent:       ", owner);
    }
}
