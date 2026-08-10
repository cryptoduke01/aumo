// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AumoVault} from "../src/AumoVault.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";

/// @notice NOT THE LAUNCH ARTIFACT. The public product ships via DeployPoolMainnet (the
///         multi-depositor AumoPool). This deploys the legacy single-depositor AumoVault, which has
///         NO loss budget and NO deploy budget: only ever allowlist a lossless venue (Aave) on it,
///         never a swap-based (lossy) venue like USDG. Kept for reference/testing only.
///
/// One-command deploy on X Layer (chainId 196): the vault plus a real Aave v3 adapter, wired and
/// allowlisted. Moves real capital once funded, so the broadcaster must equal VAULT_OWNER.
///
/// Addresses from aave-address-book/src/AaveV3XLayer.sol, verified on-chain:
///   USDT0 (USD₮0, 6dp)  0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   Aave v3 Pool        0xE3F3Caefdd7180F884c01E57f65Df979Af84f116
///   aXlrUSDT0           0xF356ae412dB5df43BD3a10746f7ad4e1C4De4297
///
/// Usage (only when you intend to spend real capital):
///   forge script script/DeployMainnet.s.sol:DeployMainnet \
///     --rpc-url "$XLAYER_MAINNET_RPC" --private-key "$PRIVATE_KEY" --broadcast
contract DeployMainnet is Script {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant AAVE_POOL = 0xE3F3Caefdd7180F884c01E57f65Df979Af84f116;
    address constant AUSDT0 = 0xF356ae412dB5df43BD3a10746f7ad4e1C4De4297;

    function run() external {
        require(block.chainid == 196, "not X Layer mainnet");
        address owner = vm.envAddress("VAULT_OWNER");
        address agent = vm.envOr("AGENT_ADDRESS", owner);
        uint256 maxMove = vm.envOr("MAX_MOVE", uint256(0));
        uint256 perVenue = vm.envOr("PER_VENUE_CAP", uint256(0));
        uint256 maxTotal = vm.envOr("MAX_TOTAL", uint256(0));

        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");
        require(maxMove > 0, "set MAX_MOVE");
        require(perVenue >= maxMove, "PER_VENUE_CAP must be >= MAX_MOVE");
        require(maxTotal >= perVenue, "MAX_TOTAL must be >= PER_VENUE_CAP");

        vm.startBroadcast();
        AumoVault vault = new AumoVault(USDT0, owner);
        AaveV3Adapter aave = new AaveV3Adapter(USDT0, AAVE_POOL, AUSDT0, address(vault));
        vault.setVenueAllowed(address(aave), true);
        vault.setPolicy(maxMove, perVenue, maxTotal);
        if (agent != owner) vault.setAgent(agent);
        vm.stopBroadcast();

        console2.log("USDT0 (asset): ", USDT0);
        console2.log("AumoVault:     ", address(vault));
        console2.log("AaveV3Adapter: ", address(aave));
        console2.log("owner:         ", owner);
        console2.log("agent:         ", agent);
    }
}
