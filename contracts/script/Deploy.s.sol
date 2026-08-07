// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AumoVault} from "../src/AumoVault.sol";

/// @notice Deploys AumoVault. Configure via env vars (see .env.example):
///   ASSET         base asset (USDT0) address on the target chain   [required]
///   VAULT_OWNER   owner / initial agent address                    [required]
///   MAX_MOVE      max asset per allocate() (base units)            [optional]
///   PER_VENUE_CAP max principal per venue (base units)             [optional]
///   MAX_TOTAL     max principal deployed overall (base units)      [optional]
///
/// Run (X Layer testnet):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $XLAYER_TESTNET_RPC --private-key $PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external returns (AumoVault vault) {
        address asset = vm.envAddress("ASSET");
        address owner = vm.envAddress("VAULT_OWNER");

        vm.startBroadcast();
        vault = new AumoVault(asset, owner);

        uint256 maxMove = vm.envOr("MAX_MOVE", uint256(0));
        if (maxMove > 0) {
            vault.setPolicy(
                maxMove, vm.envOr("PER_VENUE_CAP", uint256(0)), vm.envOr("MAX_TOTAL", uint256(0))
            );
        }
        vm.stopBroadcast();

        console2.log("AumoVault deployed:", address(vault));
        console2.log("asset (USDT0):    ", asset);
        console2.log("owner / agent:    ", owner);
    }
}
