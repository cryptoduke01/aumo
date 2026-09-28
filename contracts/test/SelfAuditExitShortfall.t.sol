// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../src/interfaces/IVenueAdapter.sol";

/// @dev A venue whose exit can be switched off (an equity adapter whose sell reverts: price past the
///      slippage floor, issuer pause, drained DEX liquidity) or made lossy (burns `lossBps` on exit).
contract BrickableVenue is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    mapping(address => uint256) public position;
    bool public bricked;
    uint256 public lossBps;

    constructor(address token_) {
        token = IERC20(token_);
    }

    function setBricked(bool b) external {
        bricked = b;
    }

    function setLossBps(uint256 bps) external {
        lossBps = bps;
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
        require(!bricked, "venue exit reverts");
        uint256 bal = position[msg.sender];
        uint256 amt = amount > bal ? bal : amount;
        position[msg.sender] = bal - amt;
        uint256 out = (amt * (10_000 - lossBps)) / 10_000;
        token.safeTransfer(msg.sender, out);
        return out;
    }

    function balanceOf(address account) external view returns (uint256) {
        return position[account];
    }
}

/// @notice Self-audit (post-exit review, Sep 2026): when every venue exit failed, `_withdraw` settled
///         "at realizable value" with no floor, burning the redeemer's shares in full for only the
///         pool's idle cash (zero when fully deployed) and handing their value to the next redeemer.
///         Fixed by MAX_EXIT_SHORTFALL_BPS: a failed exit now reverts and the holder keeps their
///         shares, while an ordinary lossy exit (swap spread) still settles at realizable value.
contract SelfAuditExitShortfallTest is Test {
    MockERC20 usdt0;
    AumoPool pool;
    BrickableVenue venue;

    address agent = address(0xA9E17);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 constant U = 1e6;

    function setUp() public {
        usdt0 = new MockERC20("USDT0", "USDT0", 6);
        pool = new AumoPool(IERC20(address(usdt0)), address(this));
        venue = new BrickableVenue(address(usdt0));
        pool.setAgent(agent);
        pool.setVenueAllowed(address(venue), true);
        pool.setPolicy(200 * U, 500 * U, 800 * U);
        for (uint256 i; i < 2; ++i) {
            address u = [alice, bob][i];
            usdt0.mint(u, 1_000 * U);
            vm.startPrank(u);
            usdt0.approve(address(pool), type(uint256).max);
            pool.deposit(100 * U, u);
            vm.stopPrank();
        }
        vm.prank(agent);
        pool.allocate(address(venue), 200 * U, "supply");
    }

    function _redeemAll(address who) internal returns (uint256) {
        uint256 sh = pool.balanceOf(who);
        vm.prank(who);
        return pool.redeem(sh, who, who);
    }

    /// The original bug: a failed venue exit no longer burns shares for nothing.
    function test_FailedVenueExit_RevertsAndKeepsShares() public {
        venue.setBricked(true);
        uint256 sh = pool.balanceOf(alice);
        uint256 owed = pool.previewRedeem(sh);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AumoPool.ExitShortfall.selector, owed, 0));
        pool.redeem(sh, alice, alice);
        assertEq(pool.balanceOf(alice), sh, "alice keeps every share");

        // venue recovers: alice exits whole, bob gets only his own deposit
        venue.setBricked(false);
        assertApproxEqAbs(_redeemAll(alice), 100 * U, 2, "alice made whole");
        assertApproxEqAbs(_redeemAll(bob), 100 * U, 2, "bob gets no windfall");
    }

    /// withdraw(assets) goes through the same settlement, so it is covered too.
    function test_FailedVenueExit_WithdrawAlsoReverts() public {
        venue.setBricked(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AumoPool.ExitShortfall.selector, 50 * U, 0));
        pool.withdraw(50 * U, alice, alice);
    }

    /// A partial exit the idle balance can cover still works while the venue is down.
    function test_IdleCoveredExit_StillWorksWhileVenueDown() public {
        usdt0.mint(address(this), 10 * U);
        usdt0.approve(address(pool), 10 * U);
        pool.deposit(10 * U, address(this)); // 10 idle
        venue.setBricked(true);
        vm.prank(alice);
        pool.withdraw(10 * U, alice, alice);
        assertEq(usdt0.balanceOf(alice), 910 * U, "idle-covered withdraw paid in full");
    }

    /// An ordinary lossy exit (the whole venue sold at a 2% spread, like an equity oracle-floored
    /// sell) still settles at realizable value instead of reverting.
    function test_OrdinarySlippage_StillSettles() public {
        venue.setLossBps(200);
        _redeemAll(bob); // bob exits first; alice becomes sole holder of what is left
        uint256 got = _redeemAll(alice); // drains the venue: realizes ~98% of the mark
        assertGt(got, 0, "paid");
        assertEq(pool.balanceOf(alice), 0, "fully exited");
    }

    /// A venue that realizes far less than its mark (10% short) reverts the full exit rather than
    /// silently settling a large loss; that belongs to the impairment path, not realizable settlement.
    function test_LargeShortfall_Reverts() public {
        venue.setLossBps(1_000);
        _redeemAll(bob);
        uint256 sh = pool.balanceOf(alice);
        vm.prank(alice);
        vm.expectPartialRevert(AumoPool.ExitShortfall.selector);
        pool.redeem(sh, alice, alice);
        assertEq(pool.balanceOf(alice), sh, "shares intact");
    }
}
