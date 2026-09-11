// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEquityOracle} from "./mocks/MockEquityOracle.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";

/// @notice End-to-end suite for the opt-in, at-risk equity pool. This contract is the pool's owner
///         and (by the constructor default) its agent, so it drives allocate/deallocate directly;
///         `alice` is an ordinary depositor. The stock's price feed doubles as the market clock.
contract EquityPoolTest is Test {
    MockERC20 usdt0;
    MockERC20 stock;
    MockEquityOracle oracle;
    MockSwapRouter router;
    EquityAdapter adapter;
    EquityPool pool;

    address alice = address(0xA11CE);

    bytes32 constant FEED = bytes32("NVDA");
    uint256 constant PX = 100e18; // $100 / share
    uint256 constant MAX_AGE = 1 hours;
    uint256 constant SLIP = 200; // 2%
    uint256 constant DEPOSIT = 1_000e6; // 1,000 USD₮0

    function setUp() public {
        vm.warp(1_800_000_000); // stable base time so staleness math never underflows

        usdt0 = new MockERC20("USD0", "USD0", 6);
        stock = new MockERC20("NVDAx", "NVDAx", 18);
        oracle = new MockEquityOracle();
        oracle.set(FEED, PX, block.timestamp); // fresh: market open

        router = new MockSwapRouter(address(usdt0), address(stock), 6, 18, PX);
        usdt0.mint(address(router), 5_000_000e6);
        stock.mint(address(router), 5_000_000e18);

        // Pool first so we can bind the adapter's vault to it, then allowlist the adapter.
        pool = new EquityPool(IERC20(address(usdt0)), address(this), address(oracle), FEED, MAX_AGE);
        adapter = new EquityAdapter(
            address(usdt0), address(stock), address(oracle), FEED, address(router), address(pool), 3000, MAX_AGE, SLIP
        );

        pool.setVenueAllowed(address(adapter), true);
        pool.setPolicy(2_000e6, 10_000e6, 20_000e6); // maxMove, perVenueCap, maxTotalDeployed
        pool.setDeployBudget(20_000e6, 1 days); // bounds churn throughput

        usdt0.mint(alice, 100_000e6);
        vm.prank(alice);
        usdt0.approve(address(pool), type(uint256).max);
    }

    /// @dev Move the oracle and the pool price together (they track in reality), keeping the clock
    ///      fresh so the market stays open. Use whenever a price change is followed by a swap.
    function _setPrice(uint256 pxWad) internal {
        oracle.set(FEED, pxWad, block.timestamp);
        router.setPrice(pxWad);
    }

    // ---------------------------------------------------------------- happy path: deposit → buy → NAV

    function test_deposit_then_agent_buys_and_nav_holds() public {
        vm.prank(alice);
        uint256 shares = pool.deposit(DEPOSIT, alice);
        assertGt(shares, 0, "minted shares");
        assertEq(pool.totalAssets(), DEPOSIT, "NAV == deposit before deploy");

        pool.allocate(address(adapter), DEPOSIT, bytes32("buy"));
        assertEq(stock.balanceOf(address(adapter)), 10e18, "1000 USD0 buys 10 shares @ $100");
        assertApproxEqAbs(pool.totalAssets(), DEPOSIT, 2, "NAV holds across the buy (flat price)");
        assertEq(pool.idleBalance(), 0, "fully deployed");
    }

    function test_nav_tracks_stock_up_and_down() public {
        vm.prank(alice);
        pool.deposit(DEPOSIT, alice);
        pool.allocate(address(adapter), DEPOSIT, bytes32("buy"));

        oracle.set(FEED, 120e18, block.timestamp); // +20%
        assertApproxEqAbs(pool.totalAssets(), 1_200e6, 2, "NAV up with the stock");

        oracle.set(FEED, 80e18, block.timestamp); // -20%
        assertApproxEqAbs(pool.totalAssets(), 800e6, 2, "NAV down with the stock");
    }

    function test_depositor_captures_upside_on_redeem() public {
        vm.prank(alice);
        uint256 shares = pool.deposit(DEPOSIT, alice);
        pool.allocate(address(adapter), DEPOSIT, bytes32("buy"));

        _setPrice(130e18); // +30% while alice is in

        uint256 before = usdt0.balanceOf(alice);
        vm.prank(alice);
        pool.redeem(shares, alice, alice);
        uint256 got = usdt0.balanceOf(alice) - before;
        assertApproxEqAbs(got, 1_300e6, 5, "directional upside flows to the depositor");
    }

    function test_partial_redeem_pulls_from_venue_cleanly() public {
        vm.prank(alice);
        uint256 shares = pool.deposit(DEPOSIT, alice);
        pool.allocate(address(adapter), DEPOSIT, bytes32("buy"));

        _setPrice(137e18); // odd price to exercise rounding on the partial sell
        uint256 before = usdt0.balanceOf(alice);
        vm.prank(alice);
        uint256 got = pool.redeem(shares / 3, alice, alice); // partial: must not brick on rounding
        assertGt(got, 0, "partial redeem realized value");
        assertEq(usdt0.balanceOf(alice) - before, got, "vault paid exactly the realized assets");
        assertGt(stock.balanceOf(address(adapter)), 0, "position only partially unwound");
    }

    // ---------------------------------------------------------------- market-hours gate (M1 fix)

    function test_deposit_blocked_when_market_closed() public {
        oracle.set(FEED, PX, block.timestamp - MAX_AGE - 1); // stale clock = market closed
        vm.prank(alice);
        vm.expectRevert(EquityPool.MarketClosed.selector);
        pool.deposit(DEPOSIT, alice);
    }

    function test_mint_blocked_when_market_closed() public {
        oracle.set(FEED, PX, block.timestamp - MAX_AGE - 1);
        vm.prank(alice);
        vm.expectRevert(EquityPool.MarketClosed.selector);
        pool.mint(1e6, alice);
    }

    function test_redeem_blocked_when_market_closed() public {
        vm.prank(alice);
        uint256 shares = pool.deposit(DEPOSIT, alice);
        pool.allocate(address(adapter), DEPOSIT, bytes32("buy"));

        oracle.set(FEED, PX, block.timestamp - MAX_AGE - 1); // market closes over the weekend
        vm.prank(alice);
        vm.expectRevert(EquityPool.MarketClosed.selector);
        pool.redeem(shares, alice, alice);
    }

    function test_withdraw_blocked_when_market_closed() public {
        vm.prank(alice);
        pool.deposit(DEPOSIT, alice);
        oracle.set(FEED, PX, block.timestamp - MAX_AGE - 1);
        vm.prank(alice);
        vm.expectRevert(EquityPool.MarketClosed.selector);
        pool.withdraw(1e6, alice, alice);
    }

    function test_zero_clock_price_counts_as_closed() public {
        oracle.set(FEED, 0, block.timestamp); // no price at all
        assertFalse(pool.marketOpen(), "no price == closed");
        vm.prank(alice);
        vm.expectRevert(EquityPool.MarketClosed.selector);
        pool.deposit(DEPOSIT, alice);
    }

    function test_reopen_lets_deposit_and_redeem_through() public {
        oracle.set(FEED, PX, block.timestamp - MAX_AGE - 1); // closed
        assertFalse(pool.marketOpen());
        oracle.set(FEED, PX, block.timestamp); // reopens
        assertTrue(pool.marketOpen());

        vm.prank(alice);
        uint256 shares = pool.deposit(DEPOSIT, alice);
        vm.prank(alice);
        uint256 got = pool.redeem(shares, alice, alice); // idle covers it, no venue needed
        assertApproxEqAbs(got, DEPOSIT, 2, "in and out cleanly while open");
    }

    // ------------------------------------------------------ agent retreat is unmetered on a drawdown

    /// @dev On the stable pool a retreat that returns less than principal is charged to the loss
    ///      budget (default 0), which would revert. Here a drawdown is a market move, not agent loss,
    ///      so the equity pool must let the agent de-risk on a down day without the budget blocking.
    function test_agent_can_retreat_on_drawdown_unmetered() public {
        vm.prank(alice);
        pool.deposit(DEPOSIT, alice);
        pool.allocate(address(adapter), DEPOSIT, bytes32("buy"));

        _setPrice(70e18); // -30%, still fresh (market open)

        uint256 idleBefore = pool.idleBalance();
        pool.deallocate(address(adapter), 500e6); // trim ~half the (now-smaller) position
        assertGt(pool.idleBalance(), idleBefore, "retreat returned USD0 to the pool, not reverted");
    }

    function test_deallocate_rejects_unlisted_venue() public {
        vm.expectRevert(AumoPool.VenueNotAllowed.selector);
        pool.deallocate(address(0xDEAD), 1e6);
    }

    function test_only_agent_can_allocate_and_deallocate() public {
        vm.prank(alice);
        vm.expectRevert(AumoPool.NotAgent.selector);
        pool.allocate(address(adapter), DEPOSIT, bytes32("x"));

        vm.prank(alice);
        vm.expectRevert(AumoPool.NotAgent.selector);
        pool.deallocate(address(adapter), 1e6);
    }

    // ---------------------------------------------------------------- config / identity

    function test_share_token_identity_is_equity() public view {
        assertEq(pool.name(), "Aumo Equity Pool");
        assertEq(pool.symbol(), "aumoEQTY");
    }

    function test_constructor_rejects_bad_config() public {
        vm.expectRevert(EquityPool.BadEquityConfig.selector); // zero oracle
        new EquityPool(IERC20(address(usdt0)), address(this), address(0), FEED, MAX_AGE);
        vm.expectRevert(EquityPool.BadEquityConfig.selector); // zero maxAge
        new EquityPool(IERC20(address(usdt0)), address(this), address(oracle), FEED, 0);
    }

    function test_setMarketClock_owner_only_and_updates() public {
        MockEquityOracle o2 = new MockEquityOracle();
        o2.set(FEED, PX, block.timestamp);

        vm.prank(alice);
        vm.expectRevert(); // Ownable: not owner
        pool.setMarketClock(address(o2), FEED, 2 hours);

        pool.setMarketClock(address(o2), FEED, 2 hours);
        assertEq(address(pool.marketOracle()), address(o2), "oracle migrated");
        assertEq(pool.marketMaxAge(), 2 hours, "maxAge updated");
    }
}
