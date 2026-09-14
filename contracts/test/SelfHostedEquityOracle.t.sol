// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SelfHostedEquityOracle} from "../src/oracles/SelfHostedEquityOracle.sol";

/// @notice Unit suite for the self-hosted equity oracle. Proves the market-status fold + staleness
///         logic (identical to the Data Streams oracle) plus the single-source guards: monotonic time,
///         future-skew bound, absurd-price cap, and the deviation circuit-breaker.
contract SelfHostedEquityOracleTest is Test {
    SelfHostedEquityOracle oracle;

    address updater = address(0xABCD);
    bytes32 constant FEED = bytes32("NVDA");

    // marketStatus values (24/5 US equities)
    uint32 constant UNKNOWN = 0;
    uint32 constant PRE = 1;
    uint32 constant REGULAR = 2;
    uint32 constant POST = 3;
    uint32 constant OVERNIGHT = 4;
    uint32 constant CLOSED = 5;

    function setUp() public {
        vm.warp(1_800_000_000);
        oracle = new SelfHostedEquityOracle(updater, address(this));
        oracle.registerFeed(FEED, true);
    }

    function _submit(uint256 pxWad, uint32 obsTs, uint32 status) internal {
        vm.prank(updater);
        oracle.submitPrice(FEED, pxWad, status, obsTs);
    }

    // --------------------------------------------------------------------- market-session fold

    function test_regular_hours_price_is_fresh() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, REGULAR);
        (uint256 px, uint256 updatedAt) = oracle.priceWad(FEED);
        assertEq(px, 100e18, "price stored as WAD");
        assertEq(updatedAt, ts, "regular hours -> real observation time (fresh)");
        assertTrue(oracle.marketTradeable(FEED));
    }

    function test_closed_market_reads_stale_but_keeps_price() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, CLOSED);
        (uint256 px, uint256 updatedAt) = oracle.priceWad(FEED);
        assertEq(px, 100e18, "NAV still sees the last price when closed");
        assertEq(updatedAt, 0, "closed -> updatedAt 0 so callers refuse to trade");
        assertFalse(oracle.marketTradeable(FEED));
    }

    function test_unknown_and_overnight_are_not_tradeable() public {
        _submit(100e18, uint32(block.timestamp), UNKNOWN);
        (, uint256 u1) = oracle.priceWad(FEED);
        assertEq(u1, 0, "unknown -> not tradeable");

        _submit(101e18, uint32(block.timestamp) + 1, OVERNIGHT);
        (, uint256 u2) = oracle.priceWad(FEED);
        assertEq(u2, 0, "overnight -> not tradeable by default");
    }

    function test_extended_hours_gated_by_owner_flag() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, PRE);
        (, uint256 uOff) = oracle.priceWad(FEED);
        assertEq(uOff, 0, "pre-market not tradeable by default");

        oracle.setAllowExtendedHours(true);
        _submit(100e18, ts + 1, POST);
        (, uint256 uOn) = oracle.priceWad(FEED);
        assertEq(uOn, ts + 1, "post-market tradeable once extended hours enabled");

        _submit(100e18, ts + 2, OVERNIGHT);
        (, uint256 uNight) = oracle.priceWad(FEED);
        assertEq(uNight, 0, "overnight needs its own opt-in");
    }

    function test_overnight_gated_by_its_own_flag() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, OVERNIGHT);
        (, uint256 uOff) = oracle.priceWad(FEED);
        assertEq(uOff, 0, "overnight not tradeable by default");

        oracle.setAllowOvernight(true);
        _submit(100e18, ts + 1, OVERNIGHT);
        (, uint256 uOn) = oracle.priceWad(FEED);
        assertEq(uOn, ts + 1, "overnight tradeable once enabled");

        oracle.setAllowExtendedHours(true);
        _submit(100e18, ts + 2, CLOSED);
        (, uint256 uClosed) = oracle.priceWad(FEED);
        assertEq(uClosed, 0, "weekend/closed never tradeable");
    }

    // --------------------------------------------------------------------- single-source guards

    function test_only_updater_can_submit() public {
        vm.expectRevert(SelfHostedEquityOracle.NotUpdater.selector);
        oracle.submitPrice(FEED, 100e18, REGULAR, uint32(block.timestamp));
    }

    function test_unregistered_feed_rejected() public {
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.FeedNotActive.selector);
        oracle.submitPrice(bytes32("TSLA"), 100e18, REGULAR, uint32(block.timestamp));
    }

    function test_deactivated_feed_rejected() public {
        oracle.registerFeed(FEED, false);
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.FeedNotActive.selector);
        oracle.submitPrice(FEED, 100e18, REGULAR, uint32(block.timestamp));
    }

    function test_zero_or_absurd_price_rejected() public {
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.PriceOutOfRange.selector);
        oracle.submitPrice(FEED, 0, REGULAR, uint32(block.timestamp));

        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.PriceOutOfRange.selector);
        oracle.submitPrice(FEED, 1_000_001 * 1e18, REGULAR, uint32(block.timestamp));
    }

    function test_monotonic_timestamp_blocks_replay_and_rollback() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, REGULAR);

        // Same timestamp (replay of the exact submission) is rejected.
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.StaleObservation.selector);
        oracle.submitPrice(FEED, 100e18, REGULAR, ts);

        // Older timestamp (rollback to a stale price) is rejected.
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.StaleObservation.selector);
        oracle.submitPrice(FEED, 90e18, REGULAR, ts - 1);

        // Strictly newer is accepted.
        _submit(105e18, ts + 1, REGULAR);
        (uint256 px,) = oracle.priceWad(FEED);
        assertEq(px, 105e18, "newer quote lands");
    }

    function test_future_observation_rejected() public {
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.FutureObservation.selector);
        oracle.submitPrice(FEED, 100e18, REGULAR, uint32(block.timestamp + 301));

        // Inside the skew tolerance is fine.
        _submit(100e18, uint32(block.timestamp + 300), REGULAR);
        (uint256 px,) = oracle.priceWad(FEED);
        assertEq(px, 100e18);
    }

    function test_deviation_breaker_off_by_default() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, REGULAR);
        // A 90% jump lands because the breaker is disabled by default.
        _submit(190e18, ts + 1, REGULAR);
        (uint256 px,) = oracle.priceWad(FEED);
        assertEq(px, 190e18, "no breaker -> large move allowed");
    }

    function test_deviation_breaker_trips_when_enabled() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, REGULAR);
        oracle.setMaxDeviationBps(1000); // 10%

        // 15% up trips it.
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.DeviationTooHigh.selector);
        oracle.submitPrice(FEED, 115e18, REGULAR, ts + 1);

        // 15% down also trips it.
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.DeviationTooHigh.selector);
        oracle.submitPrice(FEED, 85e18, REGULAR, ts + 1);

        // Exactly at the band (10%) passes.
        _submit(110e18, ts + 1, REGULAR);
        (uint256 px,) = oracle.priceWad(FEED);
        assertEq(px, 110e18, "within band lands");
    }

    function test_deviation_breaker_ignored_on_first_price() public {
        oracle.setMaxDeviationBps(1000);
        // No prior price -> breaker cannot apply; first quote of any size lands.
        _submit(500e18, uint32(block.timestamp), REGULAR);
        (uint256 px,) = oracle.priceWad(FEED);
        assertEq(px, 500e18);
    }

    function test_force_resync_bypasses_deviation_but_keeps_other_guards() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, REGULAR);
        oracle.setMaxDeviationBps(500); // 5%

        // Feeder is stuck: a real gap-up trips the breaker.
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.DeviationTooHigh.selector);
        oracle.submitPrice(FEED, 130e18, REGULAR, ts + 1);

        // Owner re-anchors past the gap.
        oracle.forceResync(FEED, 130e18, REGULAR, ts + 1);
        (uint256 px,) = oracle.priceWad(FEED);
        assertEq(px, 130e18, "resync clears the gap");

        // But resync still honors monotonic time and the price cap.
        vm.expectRevert(SelfHostedEquityOracle.StaleObservation.selector);
        oracle.forceResync(FEED, 131e18, REGULAR, ts + 1);
        vm.expectRevert(SelfHostedEquityOracle.PriceOutOfRange.selector);
        oracle.forceResync(FEED, 2_000_000 * 1e18, REGULAR, ts + 2);
    }

    function test_force_resync_only_owner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        oracle.forceResync(FEED, 100e18, REGULAR, uint32(block.timestamp));
    }

    // --------------------------------------------------------------------- batch submit

    function test_batch_submit_atomic() public {
        bytes32 tsla = bytes32("TSLA");
        oracle.registerFeed(tsla, true);
        uint32 ts = uint32(block.timestamp);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = FEED;
        ids[1] = tsla;
        uint256[] memory px = new uint256[](2);
        px[0] = 100e18;
        px[1] = 250e18;
        uint32[] memory st = new uint32[](2);
        st[0] = REGULAR;
        st[1] = REGULAR;
        uint32[] memory obs = new uint32[](2);
        obs[0] = ts;
        obs[1] = ts;

        vm.prank(updater);
        oracle.submitPrices(ids, px, st, obs);

        (uint256 p0,) = oracle.priceWad(FEED);
        (uint256 p1,) = oracle.priceWad(tsla);
        assertEq(p0, 100e18);
        assertEq(p1, 250e18);
    }

    function test_batch_reverts_whole_set_on_one_bad_entry() public {
        // Second feed unregistered -> the whole batch reverts, first price NOT stored.
        uint32 ts = uint32(block.timestamp);
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = FEED;
        ids[1] = bytes32("GHOST");
        uint256[] memory px = new uint256[](2);
        px[0] = 100e18;
        px[1] = 250e18;
        uint32[] memory st = new uint32[](2);
        st[0] = REGULAR;
        st[1] = REGULAR;
        uint32[] memory obs = new uint32[](2);
        obs[0] = ts;
        obs[1] = ts;

        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.FeedNotActive.selector);
        oracle.submitPrices(ids, px, st, obs);

        (uint256 p0,) = oracle.priceWad(FEED);
        assertEq(p0, 0, "atomic: first price not stored when a later entry fails");
    }

    function test_batch_length_mismatch_rejected() public {
        bytes32[] memory ids = new bytes32[](2);
        uint256[] memory px = new uint256[](1);
        uint32[] memory st = new uint32[](2);
        uint32[] memory obs = new uint32[](2);
        vm.prank(updater);
        vm.expectRevert(SelfHostedEquityOracle.BadConfig.selector);
        oracle.submitPrices(ids, px, st, obs);
    }

    // --------------------------------------------------------------------- misc

    function test_unset_feed_returns_zero() public view {
        (uint256 px, uint256 updatedAt) = oracle.priceWad(bytes32("MSFT"));
        assertEq(px, 0);
        assertEq(updatedAt, 0);
    }

    function test_setters_guard_zero_and_owner() public {
        vm.expectRevert(SelfHostedEquityOracle.BadConfig.selector);
        oracle.setUpdater(address(0));

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        oracle.setUpdater(address(0xCAFE));
    }
}
