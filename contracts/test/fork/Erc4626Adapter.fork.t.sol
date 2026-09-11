// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoVault} from "../../src/AumoVault.sol";
import {Erc4626Adapter} from "../../src/adapters/Erc4626Adapter.sol";

/// @notice Fork test against the real Spark Savings USDT (spUSDT) ERC-4626 vault on X Layer
///         mainnet (chainId 196). Proves the full stack — AumoVault guardrails + Erc4626Adapter —
///         supplies real USD₮0 into spUSDT, reads the position back through the share value, and
///         round-trips it out without losing principal. Runs only when XLAYER_MAINNET_RPC is set;
///         skips cleanly otherwise so the default (offline) `forge test` stays green.
///
/// Addresses verified on-chain 2026-09-11:
///   USD₮0 (6dp)                0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   spUSDT (ERC-4626, 6dp)     0xc358c90D32375721Cb3924320Fdc2F8B694347Ca  (asset() == USD₮0)
contract Erc4626AdapterForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant SPUSDT = 0xc358c90D32375721Cb3924320Fdc2F8B694347Ca;
    bytes32 constant REASON = "spusdt-supply";

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");

    AumoVault vault;
    Erc4626Adapter adapter;
    bool active;

    function setUp() public {
        // Opt-in only: default `forge test` stays fast and offline. Run with
        // `RUN_FORK=1 forge test --match-contract Erc4626AdapterForkTest`.
        if (!vm.envOr("RUN_FORK", false)) return;
        string memory rpc = vm.envOr("XLAYER_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        active = true;

        vm.startPrank(owner);
        vault = new AumoVault(USDT0, owner);
        adapter = new Erc4626Adapter(USDT0, SPUSDT, address(vault));
        vault.setVenueAllowed(address(adapter), true);
        vault.setPolicy(1_000e6, 5_000e6, 10_000e6);
        vault.setAgent(agent);
        vm.stopPrank();
    }

    function test_full_stack_supply_and_retreat_on_real_spusdt() public {
        if (!active) {
            vm.skip(true);
            return;
        }

        uint256 amount = 1_000e6;

        // The adapter is bound to the right vault: asset() must be USD₮0.
        assertEq(adapter.asset(), USDT0, "adapter asset is USD0");

        // Fund the owner and deposit into the vault.
        deal(USDT0, owner, amount);
        vm.startPrank(owner);
        IERC20(USDT0).approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        assertEq(vault.idleBalance(), amount, "vault funded");

        // Agent allocates into real spUSDT.
        vm.prank(agent);
        vault.allocate(address(adapter), amount, REASON);

        assertEq(vault.idleBalance(), 0, "idle deployed");
        assertEq(vault.allocated(address(adapter)), amount, "principal tracked");
        // Live position reads through spUSDT share value; equals the supplied amount modulo share
        // rounding (a wei or two).
        assertApproxEqAbs(vault.venueBalance(address(adapter)), amount, 3, "share position ~= supplied");

        // Warp forward. Savings accrues via the Sky Savings Rate, so the position never shrinks.
        vm.warp(block.timestamp + 30 days);
        assertGe(vault.venueBalance(address(adapter)) + 3, amount, "position holds or accrues");

        // Agent retreats the full position; principal (plus any yield) lands back as idle, modulo
        // at most a couple of wei of ERC-4626 round-trip rounding.
        vm.prank(agent);
        vault.deallocate(address(adapter), type(uint256).max);

        assertEq(vault.allocated(address(adapter)), 0, "principal cleared");
        assertGe(vault.idleBalance() + 3, amount, "principal returned to vault");
    }

    function test_constructor_rejects_asset_mismatch() public {
        if (!active) {
            vm.skip(true);
            return;
        }
        // spUSDT's asset() is USD₮0, so constructing with a different base asset must revert.
        vm.expectRevert(Erc4626Adapter.AssetMismatch.selector);
        new Erc4626Adapter(address(0xdead), SPUSDT, address(vault));
    }
}
