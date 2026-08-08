// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoVault} from "../../src/AumoVault.sol";
import {AaveV3Adapter} from "../../src/adapters/AaveV3Adapter.sol";

/// @notice Fork test against the real Aave v3 deployment on X Layer mainnet (chainId 196).
///         Proves the full stack — AumoVault guardrails + AaveV3Adapter — works against live
///         Aave, supplying real USDT0 and reading the position back through the aToken.
///         Runs only when XLAYER_MAINNET_RPC is set; skips cleanly otherwise so the default
///         `forge test` (offline) stays green.
///
/// Addresses from aave-address-book/src/AaveV3XLayer.sol, verified on-chain:
///   USDT0 (USD₮0, 6dp)  0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   Aave v3 Pool        0xE3F3Caefdd7180F884c01E57f65Df979Af84f116
///   aXlrUSDT0           0xF356ae412dB5df43BD3a10746f7ad4e1C4De4297
contract AaveV3AdapterForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant POOL = 0xE3F3Caefdd7180F884c01E57f65Df979Af84f116;
    address constant AUSDT0 = 0xF356ae412dB5df43BD3a10746f7ad4e1C4De4297;
    bytes32 constant REASON_SUPPLY = "aave-supply";

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");

    AumoVault vault;
    AaveV3Adapter adapter;
    bool active;

    function setUp() public {
        // Opt-in only: default `forge test` stays fast and offline. Run with
        // `RUN_FORK=1 forge test --match-contract AaveV3AdapterForkTest`.
        if (!vm.envOr("RUN_FORK", false)) return;
        string memory rpc = vm.envOr("XLAYER_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        active = true;

        vm.startPrank(owner);
        vault = new AumoVault(USDT0, owner);
        adapter = new AaveV3Adapter(USDT0, POOL, AUSDT0, address(vault));
        vault.setVenueAllowed(address(adapter), true);
        vault.setPolicy(1_000e6, 5_000e6, 10_000e6);
        vault.setAgent(agent);
        vm.stopPrank();
    }

    function test_full_stack_supply_and_retreat_on_real_aave() public {
        if (!active) {
            vm.skip(true);
            return;
        }

        uint256 amount = 1_000e6;

        // Fund the owner and deposit into the vault.
        deal(USDT0, owner, amount);
        vm.startPrank(owner);
        IERC20(USDT0).approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        assertEq(vault.idleBalance(), amount, "vault funded");

        // Agent allocates the per-move max into real Aave.
        vm.prank(agent);
        vault.allocate(address(adapter), amount, REASON_SUPPLY);

        assertEq(vault.idleBalance(), 0, "idle deployed");
        assertEq(vault.allocated(address(adapter)), amount, "principal tracked");
        // Live position reads through aXlrUSDT0; 1:1 with the underlying, may already have dust interest.
        assertApproxEqAbs(vault.venueBalance(address(adapter)), amount, 3, "aToken position ~= supplied");

        // Warp forward so interest visibly accrues on the real market.
        vm.warp(block.timestamp + 30 days);
        assertGe(vault.venueBalance(address(adapter)), amount, "position accrues yield");

        // Agent retreats the full position; principal + yield lands back as idle in the vault.
        vm.prank(agent);
        vault.deallocate(address(adapter), type(uint256).max);

        assertEq(vault.allocated(address(adapter)), 0, "principal cleared");
        assertGe(vault.idleBalance(), amount, "principal returned to vault");
    }
}
