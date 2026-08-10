// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../src/interfaces/IVenueAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVenueAdapter} from "./mocks/MockVenueAdapter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

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
        require(usdt0.transfer(address(pool), 10_000 * U), "donate"); // donation attack

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

    // --- audit regressions ---

    /// Yield left in a venue after its principal is fully deallocated must keep counting toward
    /// the share price (the Medium finding: totalAssets was gated on allocated[v] > 0).
    function test_totalAssets_CountsOrphanedYieldAfterDeallocate() public {
        _deposit(alice, 200 * U);
        vm.prank(agent);
        pool.allocate(address(venue), 200 * U, "supply");

        usdt0.mint(address(venue), 40 * U);
        venue.accrue(address(pool), 40 * U); // venue now holds principal 200 + yield 40

        vm.prank(agent);
        pool.deallocate(address(venue), 200 * U); // pull exactly principal -> allocated == 0
        assertEq(pool.allocated(address(venue)), 0, "principal cleared");

        assertEq(pool.totalAssets(), 240 * U, "orphaned yield still counted");
        assertApproxEqAbs(_redeemAll(alice), 240 * U, 2, "holder keeps principal + yield");
    }

    /// No standing token allowance is left to a venue after allocate.
    function test_Allowance_ZeroedAfterAllocate() public {
        _deposit(alice, 200 * U);
        vm.prank(agent);
        pool.allocate(address(venue), 100 * U, "supply");
        assertEq(usdt0.allowance(address(pool), address(venue)), 0, "no standing allowance");
    }

    function test_RenounceOwnership_Reverts() public {
        vm.expectRevert(AumoPool.RenounceDisabled.selector);
        pool.renounceOwnership();
    }

    function test_Deallocate_RevertsUnknownVenue() public {
        vm.prank(agent);
        vm.expectRevert(AumoPool.VenueNotAllowed.selector);
        pool.deallocate(address(0xDEAD), 1);
    }

    /// @notice A venue whose balanceOf() reverts no longer DoSes totalAssets (try/catch treats it
    ///         as 0); forceRemoveVenue then prunes the bricked adapter. removeVenue can't read it.
    function test_TotalAssets_SurvivesBrokenAdapter_AndForceRemove() public {
        _deposit(alice, 100 * U);
        RevertingVenue bad = new RevertingVenue(address(usdt0));
        pool.setVenueAllowed(address(bad), true);

        // Defense in depth: a reverting balanceOf contributes 0 instead of bricking pricing.
        assertEq(pool.totalAssets(), 100 * U, "pricing survives a broken adapter");
        vm.prank(bob);
        pool.deposit(10 * U, bob); // deposits still work
        assertEq(pool.totalAssets(), 110 * U, "still priced");

        // removeVenue can't read the bricked adapter (its balanceOf reverts); forceRemoveVenue can.
        pool.setVenueAllowed(address(bad), false);
        vm.expectRevert();
        pool.removeVenue(address(bad));
        pool.forceRemoveVenue(address(bad));

        uint256 shares = pool.balanceOf(alice);
        vm.prank(alice);
        pool.redeem(shares, alice, alice);
    }

    function test_RemoveVenue_RequiresDisallowFirst() public {
        vm.expectRevert(AumoPool.VenueNotAllowed.selector);
        pool.removeVenue(address(venue)); // still allowed
    }

    /// removeVenue must not silently strand recoverable value.
    function test_RemoveVenue_RevertsIfVenueHasValue() public {
        _deposit(alice, 200 * U);
        vm.prank(agent);
        pool.allocate(address(venue), 100 * U, "x"); // venue holds value
        pool.setVenueAllowed(address(venue), false);
        vm.expectRevert(AumoPool.VenueHasValue.selector);
        pool.removeVenue(address(venue));
    }

    /// HIGH fix: one venue whose withdraw reverts must not brick redemptions a healthy venue can
    /// cover. The stuck venue is skipped (try/catch), the exit clears from idle + the healthy venue.
    function test_Redemption_SkipsStuckVenue() public {
        _deposit(alice, 300 * U);
        StuckVenue stuck = new StuckVenue(address(usdt0));
        pool.setVenueAllowed(address(stuck), true);
        vm.startPrank(agent);
        pool.allocate(address(stuck), 100 * U, "s"); // 100 in a venue that can't be exited
        pool.allocate(address(venue), 100 * U, "h"); // 100 in a healthy venue
        vm.stopPrank();

        uint256 before = usdt0.balanceOf(alice);
        vm.prank(alice);
        pool.withdraw(180 * U, alice, alice); // 100 idle + 80 from the healthy venue
        assertEq(usdt0.balanceOf(alice) - before, 180 * U, "redemption clears past the stuck venue");
    }

    /// HIGH fix: the deploy budget caps re-staging via the unmetered redeem exit path.
    function test_DeployBudget_BoundsRestaging() public {
        _deposit(alice, 500 * U);
        LossyVenue lv = _lossy(300);
        pool.setDeployBudget(300 * U, 1 days); // at most 300 allocated per epoch
        vm.startPrank(agent);
        pool.allocate(address(lv), 200 * U, "1"); // 200 <= 300 ok
        vm.expectRevert(AumoPool.DeployBudgetExceeded.selector);
        pool.allocate(address(lv), 200 * U, "2"); // 400 > 300 -> revert
        vm.stopPrank();
    }

    function test_SetDeployBudget_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        pool.setDeployBudget(1, 1 days);
    }

    // --- deviykee audit (2026-08-10): NAV realizability, budget basis, phantom retreat ---

    /// H-1/L8/R1: impairing a stuck venue writes it out of NAV, so share price reflects realizable
    /// value and first redeemers can't drain healthy liquidity against inflated NAV.
    function test_Impair_ExcludesStuckVenueFromNav_FairExit() public {
        StuckVenue stuck = new StuckVenue(address(usdt0));
        _deposit(alice, 200 * U);
        _deposit(bob, 200 * U);
        pool.setVenueAllowed(address(stuck), true);
        pool.setVenueAllowed(address(venue), true);

        vm.startPrank(agent);
        pool.allocate(address(stuck), 200 * U, "stuck");
        pool.allocate(address(venue), 200 * U, "healthy");
        vm.stopPrank();
        assertEq(pool.totalAssets(), 400 * U, "full NAV before impairment");

        // Owner marks the un-exitable venue impaired: NAV writes down to realizable value.
        pool.setVenueImpaired(address(stuck), true);
        assertEq(pool.totalAssets(), 200 * U, "stuck value excluded from NAV");

        // Now alice redeems: she gets her fair share of the REALIZABLE 200 (not the inflated 400).
        uint256 before = usdt0.balanceOf(alice);
        uint256 sh = pool.balanceOf(alice);
        vm.prank(alice);
        pool.redeem(sh, alice, alice);
        assertApproxEqAbs(usdt0.balanceOf(alice) - before, 100 * U, 2, "fair pro-rata of realizable, not preferential drain");

        // Bob still holds his shares and the healthy venue still has ~100 for him.
        assertGt(pool.balanceOf(bob), 0, "bob keeps his claim");
        assertApproxEqAbs(pool.totalAssets(), 100 * U, 2, "healthy remainder still priced");
    }

    function test_SetVenueImpaired_OnlyOwner() public {
        pool.setVenueAllowed(address(venue), true);
        // A stranger cannot impair.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pool.setVenueImpaired(address(venue), true);
        // The agent cannot impair either: impairment is an owner-only NAV lever (C-1).
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        pool.setVenueImpaired(address(venue), true);
        // The owner can set and clear it.
        pool.setVenueImpaired(address(venue), true);
        pool.setVenueImpaired(address(venue), false);
    }

    function test_Impair_BlocksNewAllocation() public {
        _deposit(alice, 200 * U);
        pool.setVenueAllowed(address(venue), true);
        pool.setVenueImpaired(address(venue), true);
        vm.prank(agent);
        vm.expectRevert(AumoPool.VenueIsImpaired.selector);
        pool.allocate(address(venue), 100 * U, "x");
    }

    /// H-2/L2/L4: allocate books the NET supplied, so the loss budget doesn't re-charge the entry
    /// swap on exit — a normal RWA round trip can retreat under an exit-sized budget.
    function test_LossBudget_DoesNotDoubleCountEntryFill() public {
        pool.setPolicy(2_000 * U, 2_000 * U, 2_000 * U);
        EntryExitVenue v = new EntryExitVenue(address(usdt0), 200, 100); // 2% entry, 1% exit
        pool.setVenueAllowed(address(v), true);
        pool.setLossBudget(15 * U, 1 days); // sized for exit cost, not entry+exit

        _deposit(alice, 1_000 * U);
        vm.startPrank(agent);
        pool.allocate(address(v), 1_000 * U, "in");
        // principal booked NET (~980), not gross 1000
        assertApproxEqAbs(pool.allocated(address(v)), 980 * U, 1, "booked net supplied");
        // full retreat succeeds: loss ~= exit only (~10) < budget 15
        pool.deallocate(address(v), 1_000 * U);
        vm.stopPrank();
        assertEq(pool.allocated(address(v)), 0, "retreated cleanly");
    }

    /// H-3/L3: a venue that reports a balance but returns nothing on withdraw can't silently wipe
    /// the principal ledger — the retreat reverts (agent) / is skipped (user path).
    function test_EmptyWithdraw_Reverts_NoPhantomRetreat() public {
        pool.setPolicy(2_000 * U, 2_000 * U, 2_000 * U);
        LieVenue lie = new LieVenue(address(usdt0));
        pool.setVenueAllowed(address(lie), true);
        _deposit(alice, 1_000 * U);
        vm.prank(agent);
        pool.allocate(address(lie), 1_000 * U, "lie");

        vm.prank(agent);
        vm.expectRevert(AumoPool.EmptyWithdraw.selector);
        pool.deallocate(address(lie), 1_000 * U);
        assertEq(pool.allocated(address(lie)), 1_000 * U, "principal intact, not wiped");
    }

    /// M-1/R2: a venue whose balanceOf reverts is isolated in _ensureIdle too, so a redemption a
    /// healthy venue can cover still clears.
    function test_Redemption_SkipsRevertingBalanceOf() public {
        RevertingBalanceVenue bad = new RevertingBalanceVenue(address(usdt0));
        _deposit(alice, 300 * U);
        pool.setVenueAllowed(address(bad), true); // first in the list
        pool.setVenueAllowed(address(venue), true);
        vm.startPrank(agent);
        pool.allocate(address(bad), 150 * U, "bad");
        pool.allocate(address(venue), 150 * U, "ok");
        vm.stopPrank();

        // bad's balanceOf reverts, so its value is already out of NAV; the point is that the pull
        // loop skips the reverting view instead of bricking. A withdraw that needs a venue pull clears.
        uint256 before = usdt0.balanceOf(alice);
        vm.prank(alice);
        pool.withdraw(100 * U, alice, alice); // idle 0 -> must pull; bad view skipped, healthy pays
        assertEq(usdt0.balanceOf(alice) - before, 100 * U, "redeem clears past the reverting view");
    }

    /// M-3/L5: the deploy budget has its own window; changing the loss-budget length no longer
    /// desyncs the deploy window.
    function test_DeployBudget_WindowDecoupledFromLossBudget() public {
        _deposit(alice, 1_000 * U);
        pool.setVenueAllowed(address(venue), true);
        pool.setDeployBudget(100 * U, 1 days);
        vm.prank(agent);
        pool.allocate(address(venue), 100 * U, "1"); // budget spent

        // Changing the loss-budget length must NOT roll the deploy window.
        pool.setLossBudget(0, 1); // 1-second loss epoch
        vm.warp(block.timestamp + 2);
        vm.prank(agent);
        vm.expectRevert(AumoPool.DeployBudgetExceeded.selector);
        pool.allocate(address(venue), 100 * U, "2"); // deploy window still open, still over budget
    }

    function test_SetAgent_RejectsZero() public {
        vm.expectRevert(AumoPool.ZeroAgent.selector);
        pool.setAgent(address(0));
    }

    /// C-candidate (deviykee): a dust withdraw must NOT force-liquidate the whole lossy venue.
    /// Previously lastPass used pull=max, so withdraw(1) drained the entire position through the
    /// exit swap (O(1) action -> O(TVL) forced exit + MEV on full notional). The over-ask fix pulls
    /// only ~need.
    function test_DustRedeem_DoesNotLiquidateLossyVenue() public {
        pool.setPolicy(20_000 * U, 20_000 * U, 20_000 * U);
        LossyVenue lv = _lossy(200); // 2% exit swap
        _deposit(alice, 10_000 * U);
        vm.prank(agent);
        pool.allocate(address(lv), 10_000 * U, "all"); // idle 0, whole pool in the lossy venue

        uint256 faceBefore = lv.position(address(pool));
        assertEq(faceBefore, 10_000 * U);

        vm.prank(alice);
        pool.withdraw(1 * U, alice, alice); // 1 USDT0 dust

        uint256 faceAfter = lv.position(address(pool));
        assertGt(faceAfter, 9_900 * U, "dust redeem must not liquidate the venue");
        assertLt(faceBefore - faceAfter, 10 * U, "pulled only ~need, not the full notional");
    }

    // --- HIGH finding fix: a compromised agent cannot drain the treasury by churning a lossy venue ---

    function _lossy(uint256 lossBps) internal returns (LossyVenue lv) {
        lv = new LossyVenue(address(usdt0), lossBps);
        pool.setVenueAllowed(address(lv), true);
    }

    /// The core finding: caps bound size, not frequency/cumulative loss. Each round trip through a
    /// lossy swap venue burns value; a hostile agent loops allocate->deallocate to empty the vault.
    /// The per-epoch loss budget caps that value destruction.
    function test_LossBudget_BoundsCompromisedAgentChurn() public {
        _deposit(alice, 200 * U);
        LossyVenue lv = _lossy(300); // 3% burned per round trip
        pool.setLossBudget(5 * U, 1 days); // at most 5 USDT0 of churn loss per day

        vm.startPrank(agent);
        pool.allocate(address(lv), 100 * U, "1");
        pool.deallocate(address(lv), 100 * U); // realizes ~3 loss, inside budget
        assertApproxEqAbs(pool.epochLoss(), 3 * U, 1, "first round-trip loss charged");

        // keep churning; the next realized loss pushes cumulative loss over the budget and reverts
        uint256 idleNow = pool.idleBalance();
        pool.allocate(address(lv), idleNow, "2");
        vm.expectRevert(AumoPool.LossBudgetExceeded.selector);
        pool.deallocate(address(lv), idleNow);
        vm.stopPrank();

        assertLe(pool.epochLoss(), 5 * U, "committed value destruction never exceeds the budget");
    }

    /// The budget is a rate limit, not a permanent lock: it refreshes each epoch.
    function test_LossBudget_ResetsNextEpoch() public {
        _deposit(alice, 200 * U);
        LossyVenue lv = _lossy(300);
        pool.setLossBudget(5 * U, 1 days);

        vm.startPrank(agent);
        pool.allocate(address(lv), 100 * U, "1");
        pool.deallocate(address(lv), 100 * U);
        assertGt(pool.epochLoss(), 0, "spent some budget");
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days + 1); // a full epoch later
        vm.startPrank(agent);
        pool.allocate(address(lv), 100 * U, "2"); // same-size trip, loss ~3 < budget
        pool.deallocate(address(lv), 100 * U); // succeeds -> epoch rolled, counter reset
        vm.stopPrank();
        assertApproxEqAbs(pool.epochLoss(), 3 * U, 1, "counter reset to just this epoch's loss");
    }

    /// A depositor can always exit through a lossy venue, even with the agent budget fully spent
    /// (here zero): the user-withdrawal path ignores the budget, so redemptions never brick.
    function test_LossBudget_DoesNotBlockUserWithdrawals() public {
        _deposit(alice, 200 * U);
        LossyVenue lv = _lossy(300);
        pool.setLossBudget(0, 1 days); // agent cannot churn at all...

        vm.prank(agent);
        pool.allocate(address(lv), 100 * U, "1"); // idle 100, venue 100

        // ...yet the depositor still redeems, serviced by retreating from the lossy venue.
        uint256 before = usdt0.balanceOf(alice);
        uint256 sh = pool.balanceOf(alice); // compute before prank (arg-eval would consume it)
        vm.prank(alice);
        pool.redeem(sh, alice, alice);
        assertGt(usdt0.balanceOf(alice) - before, 195 * U, "user exits despite zero agent budget");
    }

    /// Fail-closed default: before the owner sets a budget (maxEpochLoss == 0), the agent cannot
    /// realize any round-trip loss at all.
    function test_LossBudget_DefaultFailsClosedOnLossyChurn() public {
        _deposit(alice, 200 * U);
        LossyVenue lv = _lossy(300);
        vm.startPrank(agent);
        pool.allocate(address(lv), 100 * U, "1");
        vm.expectRevert(AumoPool.LossBudgetExceeded.selector);
        pool.deallocate(address(lv), 100 * U);
        vm.stopPrank();
    }

    /// A lossless retreat (yield covered the round trip) is never charged, even at zero budget.
    function test_LossBudget_LosslessDeallocateAlwaysAllowed() public {
        _deposit(alice, 200 * U);
        vm.prank(agent);
        pool.allocate(address(venue), 200 * U, "supply"); // lossless mock venue
        vm.prank(agent);
        pool.deallocate(address(venue), 200 * U); // returned == principal -> no loss, no charge
        assertEq(pool.epochLoss(), 0, "no loss charged");
    }

    function test_SetLossBudget_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        pool.setLossBudget(1, 1 days);
    }

    function test_SetLossBudget_ZeroEpochReverts() public {
        vm.expectRevert(AumoPool.ZeroEpoch.selector);
        pool.setLossBudget(1, 0);
    }
}

/// @dev A venue adapter whose balanceOf() always reverts, to prove the totalAssets DoS + fix.
contract RevertingVenue {
    address public immutable token;

    constructor(address t) {
        token = t;
    }

    function asset() external view returns (address) {
        return token;
    }

    function balanceOf(address) external pure returns (uint256) {
        revert("balanceOf boom");
    }

    function deposit(uint256 a) external pure returns (uint256) {
        return a;
    }

    function withdraw(uint256 a) external pure returns (uint256) {
        return a;
    }
}

/// @dev A venue that burns `lossBps` of value on every round trip (models the USDT0<->USDG AMM
///      spread in RwaUsdgAdapter). balanceOf reports the realizable (post-exit) value and withdraw
///      pays it out, so the two stay consistent — a single discount, matching the real adapter.
contract LossyVenue is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint256 public immutable lossBps; // burned on exit
    mapping(address => uint256) public position; // face value held (in asset terms)

    constructor(address token_, uint256 lossBps_) {
        token = IERC20(token_);
        lossBps = lossBps_;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 amount) external returns (uint256) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        position[msg.sender] += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 bal = position[msg.sender];
        uint256 amt = amount > bal ? bal : amount;
        position[msg.sender] = bal - amt;
        uint256 out = (amt * (10_000 - lossBps)) / 10_000; // burn the spread on exit
        token.safeTransfer(msg.sender, out);
        return out;
    }

    function balanceOf(address account) external view returns (uint256) {
        return (position[account] * (10_000 - lossBps)) / 10_000; // realizable value
    }
}

/// @dev A venue that holds funds and reports a balance, but whose withdraw always reverts (models a
///      USDG depeg past the swap floor or a paused Aave reserve). Used to prove redemption isolation.
contract StuckVenue is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    mapping(address => uint256) public position;

    constructor(address token_) {
        token = IERC20(token_);
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 amount) external returns (uint256) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        position[msg.sender] += amount;
        return amount;
    }

    function withdraw(uint256) external pure returns (uint256) {
        revert("stuck");
    }

    function balanceOf(address account) external view returns (uint256) {
        return position[account];
    }
}

/// @dev Burns `entryBps` on deposit and `exitBps` on withdraw (models the RWA swap on both legs).
contract EntryExitVenue is IVenueAdapter {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    uint256 public immutable entryBps;
    uint256 public immutable exitBps;
    mapping(address => uint256) public position;

    constructor(address token_, uint256 entryBps_, uint256 exitBps_) {
        token = IERC20(token_);
        entryBps = entryBps_;
        exitBps = exitBps_;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 amount) external returns (uint256) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 credited = (amount * (10_000 - entryBps)) / 10_000; // entry burn
        position[msg.sender] += credited;
        return credited;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 bal = position[msg.sender];
        uint256 amt = amount > bal ? bal : amount;
        position[msg.sender] = bal - amt;
        uint256 out = (amt * (10_000 - exitBps)) / 10_000;
        token.safeTransfer(msg.sender, out);
        return out;
    }

    function balanceOf(address account) external view returns (uint256) {
        return position[account];
    }
}

/// @dev Reports a balance but its withdraw is a silent no-op (returns 0, no revert).
contract LieVenue is IVenueAdapter {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    mapping(address => uint256) public position;

    constructor(address token_) {
        token = IERC20(token_);
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 amount) external returns (uint256) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        position[msg.sender] += amount;
        return amount;
    }

    function withdraw(uint256) external pure returns (uint256) {
        return 0; // silent no-op: transfers nothing, does not revert
    }

    function balanceOf(address account) external view returns (uint256) {
        return position[account];
    }
}

/// @dev deposit/withdraw work, but balanceOf always reverts (asymmetric broken view).
contract RevertingBalanceVenue is IVenueAdapter {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    mapping(address => uint256) public position;

    constructor(address token_) {
        token = IERC20(token_);
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 amount) external returns (uint256) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        position[msg.sender] += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 bal = position[msg.sender];
        uint256 amt = amount > bal ? bal : amount;
        position[msg.sender] = bal - amt;
        token.safeTransfer(msg.sender, amt);
        return amt;
    }

    function balanceOf(address) external pure returns (uint256) {
        revert("balanceOf boom");
    }
}
