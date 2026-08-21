// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ZapDeposit} from "../src/ZapDeposit.sol";

/// @notice Deploy the one-click deposit zap against the existing mainnet pool (chainId 196). The zap
///         is stateless, ownerless, and custody-free, so there is nothing to configure post-deploy;
///         just point the web app's NEXT_PUBLIC_ZAP at the printed address. No pool change needed.
///
///   SwapRouter02  0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA
///
/// Usage:
///   POOL=0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F \
///   forge script script/DeployZapMainnet.s.sol:DeployZapMainnet \
///     --rpc-url https://rpc.xlayer.tech --private-key "$PRIVATE_KEY" --broadcast
contract DeployZapMainnet is Script {
    address constant UNI_ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA; // SwapRouter02

    function run() external {
        require(block.chainid == 196, "not X Layer mainnet");
        address pool = vm.envAddress("POOL");

        vm.startBroadcast();
        ZapDeposit zap = new ZapDeposit(pool, UNI_ROUTER);
        vm.stopBroadcast();

        console2.log("ZapDeposit deployed:", address(zap));
        console2.log("AumoPool:           ", pool);
        console2.log("Set NEXT_PUBLIC_ZAP to the ZapDeposit address in the web env to enable USDG deposits.");
    }
}
