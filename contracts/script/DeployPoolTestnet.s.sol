// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../src/AumoPool.sol";

/// @notice Deploy the multi-depositor pool to X Layer testnet, reusing the existing test USDT0
///         and mock venue from the AumoVault testnet deployment. Broadcaster must be VAULT_OWNER.
contract DeployPoolTestnet is Script {
    address constant TEST_USDT0 = 0xFc440733d882f28012B190b11Bbec56b44508448;
    address constant MOCK_VENUE = 0xB6bF363394FD900cb00605A43a3F6b8a4D1fE05e;

    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");

        vm.startBroadcast();
        AumoPool pool = new AumoPool(IERC20(TEST_USDT0), owner);
        pool.setVenueAllowed(MOCK_VENUE, true);
        pool.setPolicy(100e6, 500e6, 1000e6); // maxMove, perVenueCap, maxTotalDeployed
        vm.stopBroadcast();

        console2.log("AumoPool:", address(pool));
        console2.log("asset (USDT0):", TEST_USDT0);
        console2.log("venue:", MOCK_VENUE);
        console2.log("owner/agent:", owner);
    }
}
