// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";

/// @notice One-command X Layer MAINNET launch (chainId 196): the multi-depositor AumoPool
///         (ERC-4626) plus a real Aave v3 adapter, wired and allowlisted. This is the public
///         product surface — anyone can deposit USDT0 and receive shares; the agent allocates
///         the pooled balance into real Aave yield within the on-chain caps set here.
///
/// Real X Layer mainnet addresses (aave-address-book/src/AaveV3XLayer.sol, verified on-chain):
///   USDT0 (USD₮0, 6dp)  0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   Aave v3 Pool        0xE3F3Caefdd7180F884c01E57f65Df979Af84f116
///   aXlrUSDT0           0xF356ae412dB5df43BD3a10746f7ad4e1C4De4297
///
/// The full stack is fork-proven against this exact Aave deployment
/// (test/fork/AaveV3Adapter.fork.t.sol, passing).
///
/// Usage (spends real gas; broadcaster must equal VAULT_OWNER):
///   VAULT_OWNER=0xYou \
///   MAX_MOVE=100000000 PER_VENUE_CAP=1000000000 MAX_TOTAL=5000000000 \
///   forge script script/DeployPoolMainnet.s.sol:DeployPoolMainnet \
///     --rpc-url https://rpc.xlayer.tech --private-key "$PRIVATE_KEY" --broadcast
contract DeployPoolMainnet is Script {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant AAVE_POOL = 0xE3F3Caefdd7180F884c01E57f65Df979Af84f116;
    address constant AUSDT0 = 0xF356ae412dB5df43BD3a10746f7ad4e1C4De4297;

    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        address agent = vm.envOr("AGENT_ADDRESS", owner);
        // Conservative launch caps by default (in USDT0 6dp): $100 per move, $1000 per venue,
        // $5000 total deployed. Override via env for a larger launch.
        uint256 maxMove = vm.envOr("MAX_MOVE", uint256(100e6));
        uint256 perVenue = vm.envOr("PER_VENUE_CAP", uint256(1_000e6));
        uint256 maxTotal = vm.envOr("MAX_TOTAL", uint256(5_000e6));

        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");
        require(maxMove > 0, "set MAX_MOVE");
        require(perVenue >= maxMove, "PER_VENUE_CAP must be >= MAX_MOVE");
        require(maxTotal >= perVenue, "MAX_TOTAL must be >= PER_VENUE_CAP");

        vm.startBroadcast();
        AumoPool pool = new AumoPool(IERC20(USDT0), owner);
        AaveV3Adapter aave = new AaveV3Adapter(USDT0, AAVE_POOL, AUSDT0, address(pool));
        pool.setVenueAllowed(address(aave), true);
        pool.setPolicy(maxMove, perVenue, maxTotal);
        if (agent != owner) pool.setAgent(agent);
        vm.stopBroadcast();

        console2.log("USDT0 (asset): ", USDT0);
        console2.log("AumoPool:      ", address(pool));
        console2.log("AaveV3Adapter: ", address(aave));
        console2.log("owner:         ", owner);
        console2.log("agent:         ", agent);
        console2.log("caps (maxMove/perVenue/maxTotal):", maxMove, perVenue, maxTotal);
    }
}
