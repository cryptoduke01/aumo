// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../../src/AumoPool.sol";
import {UniV3LpAdapter} from "../../src/adapters/UniV3LpAdapter.sol";

/// @notice Fork test against real X Layer mainnet (chainId 196). Proves the full-range USDG/USDT0 LP
///         venue end to end: the pool's USDT0 is half-swapped to USDG on live Uniswap v3, minted as
///         full-range liquidity into the real 0.01% USDG/USDT0 pool, valued through the pool's live
///         sqrt price, and fully unwound back to USDT0. Runs only with RUN_FORK=1 + a mainnet RPC.
///
///   USDT0        0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   USDG         0x4ae46a509F6b1D9056937BA4500cb143933D2dc8
///   USDG/USDT0   0x0cBe0dBE1400e57f371a38BD3b9bC80F7C3676dA  (0.01% fee, tickSpacing 1)
///   SwapRouter02 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA
contract UniV3LpAdapterForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant POOL = 0x0cBe0dBE1400e57f371a38BD3b9bC80F7C3676dA;
    address constant UNI_ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    uint24 constant FEE = 100;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address alice = makeAddr("alice");

    AumoPool aumo;
    UniV3LpAdapter adapter;
    bool active;

    function setUp() public {
        if (!vm.envOr("RUN_FORK", false)) return;
        string memory rpc = vm.envOr("XLAYER_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        vm.startPrank(owner);
        aumo = new AumoPool(IERC20(USDT0), owner);
        // 2% swap floor, 50bps NAV discount.
        adapter = new UniV3LpAdapter(USDT0, USDG, POOL, UNI_ROUTER, address(aumo), owner, FEE, 200, 50);
        aumo.setVenueAllowed(address(adapter), true);
        aumo.setPolicy(1_000e6, 5_000e6, 10_000e6);
        aumo.setLossBudget(500e6, 1 days);
        aumo.setAgent(agent);
        vm.stopPrank();
        active = true;
    }

    function _fund(uint256 amount) internal {
        deal(USDT0, alice, amount);
        vm.startPrank(alice);
        IERC20(USDT0).approve(address(aumo), amount);
        aumo.deposit(amount, alice);
        vm.stopPrank();
    }

    function test_lp_deposit_value_and_full_exit_on_real_xlayer() public {
        if (!active) {
            vm.skip(true);
            return;
        }

        uint256 amount = 500e6;
        _fund(amount);
        assertEq(aumo.idleBalance(), amount, "pool funded");

        // Agent routes USDT0 -> (half USDG) -> full-range LP mint.
        vm.prank(agent);
        aumo.allocate(address(adapter), amount, "usdg-usdt0-lp");
        assertEq(aumo.idleBalance(), 0, "idle deployed");

        // Position valued from the pool's live sqrt price; within the round-trip swap cost of principal.
        uint256 pos = aumo.venueBalance(address(adapter));
        assertGt(pos, (amount * 97) / 100, "LP position within round-trip cost of principal");
        assertLt(pos, (amount * 101) / 100, "LP position not overvalued above principal");

        // Full exit: burn the whole position, collect, swap USDG -> USDT0, back to the vault.
        vm.prank(agent);
        aumo.deallocate(address(adapter), type(uint256).max);
        assertEq(aumo.allocated(address(adapter)), 0, "principal cleared");
        assertGt(aumo.idleBalance(), (amount * 96) / 100, "principal returned minus round-trip cost");
    }

    /// @notice Availability: balanceOf must never revert (it feeds the pool-wide totalAssets).
    function test_lp_balanceOf_is_zero_before_any_deposit() public {
        if (!active) {
            vm.skip(true);
            return;
        }
        assertEq(adapter.balanceOf(address(0)), 0, "no position -> zero NAV, no revert");
    }
}
