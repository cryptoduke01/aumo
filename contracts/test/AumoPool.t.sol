// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVenueAdapter} from "./mocks/MockVenueAdapter.sol";

/// @notice Proves the multi-depositor pool: shares track pooled value including venue yield,
///         withdrawals pull from venues, the agent stays inside every guardrail, and the
///         first-depositor inflation attack does not pay.
contract AumoPoolTest is Test {
    MockERC20 usdt0;
    AumoPool pool;
    MockVenueAdapter venue;

    address owner = address(this);
    address agent = address(0xA9E17);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address stranger = address(0xBEEF);

    uint256 constant U = 1e6;

    function setUp() public {
        usdt0 = new MockERC20("USDT0", "USDT0", 6);
        pool = new AumoPool(IERC20(address(usdt0)), owner);
        venue = new MockVenueAdapter(address(usdt0));
        pool.setAgent(agent);
        pool.setVenueAllowed(address(venue), true);
        pool.setPolicy(200 * U, 500 * U, 800 * U); // maxMove, perVenueCap, totalCap

        for (uint256 i; i < 3; ++i) {
            address u = [alice, bob, stranger][i];
            usdt0.mint(u, 10_000 * U);
            vm.prank(u);
            usdt0.approve(address(pool), type(uint256).max);
        }
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        return pool.deposit(amount, who);
    }

    function _redeemAll(address who) internal returns (uint256 assets) {
        uint256 sh = pool.balanceOf(who);
        vm.prank(who);
        return pool.redeem(sh, who, who);
    }

    // --- shares ---

    function test_Deposit_MintsShares_RedeemsBack() public {
        uint256 before = usdt0.balanceOf(alice);
        _deposit(alice, 100 * U);
        assertGt(pool.balanceOf(alice), 0, "got shares");
        assertEq(pool.totalAssets(), 100 * U, "assets in pool");
        uint256 got = _redeemAll(alice);
        assertApproxEqAbs(got, 100 * U, 1, "redeemed principal");
        assertApproxEqAbs(usdt0.balanceOf(alice), before, 1, "made whole");
    }

    function test_TwoDepositors_ProportionalShares() public {
        _deposit(alice, 100 * U);
        _deposit(bob, 300 * U);
        // bob put in 3x, should hold ~3x the shares
        assertApproxEqRel(pool.balanceOf(bob), pool.balanceOf(alice) * 3, 1e12, "3x shares");
        assertApproxEqAbs(_redeemAll(alice), 100 * U, 1, "alice principal");
        assertApproxEqAbs(_redeemAll(bob), 300 * U, 1, "bob principal");
    }

    // --- yield accrues to depositors pro-rata, withdrawals pull from venues ---

    function test_YieldDistributesProRata_AndWithdrawPullsFromVenue() public {
        _deposit(alice, 100 * U);
        _deposit(bob, 100 * U); // total 200

        vm.prank(agent);
        pool.allocate(address(venue), 200 * U, "supply"); // all idle deployed
        assertEq(pool.idleBalance(), 0, "fully deployed");

        // 20 USDT0 of yield accrues in the venue (fund the mock so it can pay out)
        usdt0.mint(address(venue), 20 * U);
        venue.accrue(address(pool), 20 * U);

        assertEq(pool.totalAssets(), 220 * U, "assets include venue yield");

        // each depositor owns half -> ~110 back, serviced by retreating from the venue
        assertApproxEqAbs(_redeemAll(alice), 110 * U, 2, "alice principal + yield");
        assertApproxEqAbs(_redeemAll(bob), 110 * U, 2, "bob principal + yield");
    }

    function test_Withdraw_PullsFromVenueWhenIdleShort() public {
        _deposit(alice, 300 * U);
        vm.prank(agent);
        pool.allocate(address(venue), 200 * U, "supply"); // idle 100, venue 200

        uint256 before = usdt0.balanceOf(alice);
        vm.prank(alice);
        pool.withdraw(250 * U, alice, alice); // needs 150 from the venue
        assertEq(usdt0.balanceOf(alice) - before, 250 * U, "paid in full");
        assertEq(pool.totalDeployed(), 50 * U, "venue drawn down to cover");
    }

    function test_TotalAssets_TracksIdlePlusVenue() public {
        _deposit(alice, 300 * U);
        vm.prank(agent);
        pool.allocate(address(venue), 200 * U, "supply");
        assertEq(pool.totalAssets(), 300 * U, "idle 100 + venue 200");
        usdt0.mint(address(venue), 15 * U);
        venue.accrue(address(pool), 15 * U);
        assertEq(pool.totalAssets(), 315 * U, "yield reflected");
    }

    // --- guardrails ---

    function test_Allocate_OnlyAgent() public {
        _deposit(alice, 100 * U);
        vm.prank(stranger);
        vm.expectRevert(AumoPool.NotAgent.selector);
        pool.allocate(address(venue), 10 * U, "x");
    }

    function test_Allocate_RevertOverMoveSize() public {
        _deposit(alice, 500 * U);
        vm.prank(agent);
        vm.expectRevert(AumoPool.MoveTooLarge.selector);
        pool.allocate(address(venue), 201 * U, "x");
    }

    function test_Allocate_RevertOverPerVenueCap() public {
        _deposit(alice, 700 * U);
        vm.startPrank(agent);
        pool.allocate(address(venue), 200 * U, "1");
        pool.allocate(address(venue), 200 * U, "2");
        pool.allocate(address(venue), 100 * U, "3"); // 500 == cap
        vm.expectRevert(AumoPool.PerVenueCapExceeded.selector);
        pool.allocate(address(venue), 1 * U, "4");
        vm.stopPrank();
    }

    function test_Allocate_RevertNotAllowlisted() public {
        _deposit(alice, 100 * U);
        MockVenueAdapter rogue = new MockVenueAdapter(address(usdt0));
        vm.prank(agent);
        vm.expectRevert(AumoPool.VenueNotAllowed.selector);
        pool.allocate(address(rogue), 10 * U, "x");
    }

    function test_Pause_BlocksDepositAndAllocate_NotRedeem() public {
        _deposit(alice, 100 * U);
        pool.pause();

        vm.prank(bob);
        vm.expectRevert(); // Pausable: EnforcedPause
        pool.deposit(100 * U, bob);

        vm.prank(agent);
        vm.expectRevert();
        pool.allocate(address(venue), 10 * U, "x");

        // redeem must still work while paused
        assertApproxEqAbs(_redeemAll(alice), 100 * U, 1, "exit while paused");
    }

    function test_SetPolicy_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        pool.setPolicy(1, 1, 1);
    }

    function test_SetVenueAllowed_RevertAssetMismatch() public {
        MockERC20 other = new MockERC20("OTHER", "OTH", 6);
        MockVenueAdapter wrong = new MockVenueAdapter(address(other));
        vm.expectRevert(AumoPool.AssetMismatch.selector);
        pool.setVenueAllowed(address(wrong), true);
    }

    // --- the first-depositor inflation attack does not pay ---

    function test_InflationAttack_DoesNotStealFromVictim() public {
        // Attacker mints 1 share with a dust deposit, then donates a large amount directly to the
        // pool to inflate share price. With virtual shares the victim still gets fair value.
        usdt0.mint(stranger, 20_000 * U); // headroom to dust-deposit AND donate
        vm.prank(stranger);
        pool.deposit(1, stranger); // 1 wei of asset
        vm.prank(stranger);
        usdt0.transfer(address(pool), 10_000 * U); // donation attack

        uint256 attackerIn = 1 + 10_000 * U; // dust deposit + donation

        vm.prank(alice);
        pool.deposit(100 * U, alice);
        assertGt(pool.balanceOf(alice), 0, "victim not rounded to zero shares");

        // The core invariant: the attacker cannot get out more than they put in.
        uint256 attackerOut = _redeemAll(stranger);
        assertLe(attackerOut, attackerIn, "attacker cannot profit");

        // And the victim recovers essentially all of their deposit.
        uint256 got = _redeemAll(alice);
        assertGe(got, 999 * U / 10, "victim keeps ~all value"); // >= 99.9
    }
}
