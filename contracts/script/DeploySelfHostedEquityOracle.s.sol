// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SelfHostedEquityOracle} from "../src/oracles/SelfHostedEquityOracle.sol";

/// @notice Deploy the self-hosted equity oracle and register the xStock catalog. This is the price
///         source Aumo runs while an enterprise network (Chainlink Data Streams / Supra) is not yet
///         available for equities on X Layer. The off-chain feeder (agent `equity-oracle-update-self`)
///         is the `updater`; the owner keeps config + the forceResync escape hatch. Consumers read the
///         oracle-agnostic IEquityOracle, so migrating later is a single setOracle on the adapter.
///
///         Broadcaster must be VAULT_OWNER. Set EQUITY_UPDATER to the feeder key (defaults to owner if
///         unset). Each registered symbol here must match the EQUITY_SYMBOLS the feeder polls, since the
///         feedId is bytes32(symbol) on both sides.
contract DeploySelfHostedEquityOracle is Script {
    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");
        address updater = vm.envOr("EQUITY_UPDATER", owner);

        // The xStock catalog, registered as bytes32(symbol) — matching the feeder's stringToHex(symbol,
        // {size:32}). Keep in lockstep with EQUITY_SYMBOLS and the web catalog. Add or drop by editing
        // this list and re-running registerFeed as owner.
        bytes32[8] memory feeds = [
            bytes32("NVDA"),
            bytes32("TSLA"),
            bytes32("AAPL"),
            bytes32("MSFT"),
            bytes32("AMZN"),
            bytes32("META"),
            bytes32("GOOGL"),
            bytes32("COIN")
        ];

        vm.startBroadcast();
        SelfHostedEquityOracle oracle = new SelfHostedEquityOracle(updater, owner);
        for (uint256 i = 0; i < feeds.length; ++i) {
            oracle.registerFeed(feeds[i], true);
        }
        vm.stopBroadcast();

        console2.log("SelfHostedEquityOracle:", address(oracle));
        console2.log("owner:                 ", owner);
        console2.log("updater (feeder key):  ", updater);
        console2.log("registered symbols:     NVDA,TSLA,AAPL,MSFT,AMZN,META,GOOGL,COIN");
    }
}
