// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChainlinkStreamsEquityOracle} from "../src/oracles/ChainlinkStreamsEquityOracle.sol";
import {MockVerifierProxy} from "./mocks/MockVerifierProxy.sol";

/// @notice Unit suite for the Data Streams equity oracle. Proves the decode -> scale -> market-status
///         fold -> staleness logic against a mock verifier that returns whatever report we encode.
///         The v11 wire format itself is confirmed at mainnet against Chainlink's canonical lib.
contract ChainlinkStreamsEquityOracleTest is Test {
    MockVerifierProxy verifier;
    ChainlinkStreamsEquityOracle oracle;

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
        verifier = new MockVerifierProxy();
        oracle = new ChainlinkStreamsEquityOracle(address(verifier), updater, address(this));
        oracle.registerFeed(FEED, 18, true); // NVDA feed, mid in 18 decimals
    }

    /// @dev Build a Data Streams payload the mock verifier will accept: the outer envelope is
    ///      (bytes32[3] reportContext, bytes reportData); reportData is the abi-encoded v11 report.
    function _payload(bytes32 feedId, int192 mid, uint32 obsTs, uint32 status)
        internal
        pure
        returns (bytes memory)
    {
        ChainlinkStreamsEquityOracle.ReportV11 memory r = ChainlinkStreamsEquityOracle.ReportV11({
            feedId: feedId,
            validFromTimestamp: obsTs,
            observationsTimestamp: obsTs,
            nativeFee: 0,
            linkFee: 0,
            expiresAt: obsTs + 1 days,
            mid: mid,
            lastSeenTimestampNs: 0,
            bid: mid,
            bidVolume: 0,
            ask: mid,
            askVolume: 0,
            lastTradedPrice: mid,
            marketStatus: status
        });
        bytes memory reportData = abi.encode(r);
        bytes32[3] memory ctx;
        return abi.encode(ctx, reportData);
    }

    function _submit(int192 mid, uint32 obsTs, uint32 status) internal {
        vm.prank(updater);
        oracle.updateReport(_payload(FEED, mid, obsTs, status));
    }

    function test_regular_hours_price_is_fresh() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, REGULAR);
        (uint256 px, uint256 updatedAt) = oracle.priceWad(FEED);
        assertEq(px, 100e18, "mid stored as WAD");
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

        _submit(100e18, uint32(block.timestamp), OVERNIGHT);
        (, uint256 u2) = oracle.priceWad(FEED);
        assertEq(u2, 0, "overnight -> never tradeable");
    }

    function test_extended_hours_gated_by_owner_flag() public {
        uint32 ts = uint32(block.timestamp);
        _submit(100e18, ts, PRE);
        (, uint256 uOff) = oracle.priceWad(FEED);
        assertEq(uOff, 0, "pre-market not tradeable by default");

        oracle.setAllowExtendedHours(true);
        _submit(100e18, ts, POST);
        (, uint256 uOn) = oracle.priceWad(FEED);
        assertEq(uOn, ts, "post-market tradeable once extended hours enabled");

        // Overnight stays closed even with extended hours on.
        _submit(100e18, ts, OVERNIGHT);
        (, uint256 uNight) = oracle.priceWad(FEED);
        assertEq(uNight, 0, "overnight never tradeable");
    }

    function test_price_scales_from_feed_decimals() public {
        bytes32 feed8 = bytes32("AAPL");
        oracle.registerFeed(feed8, 8, true); // mid in 8 decimals
        vm.prank(updater);
        oracle.updateReport(_payload(feed8, 22750000000, uint32(block.timestamp), REGULAR)); // $227.5 @ 8dp
        (uint256 px,) = oracle.priceWad(feed8);
        assertEq(px, 227.5e18, "8dp mid scaled to WAD");
    }

    function test_zero_or_negative_mid_yields_no_price() public {
        _submit(0, uint32(block.timestamp), REGULAR);
        (uint256 px, uint256 updatedAt) = oracle.priceWad(FEED);
        assertEq(px, 0, "no price");
        assertEq(updatedAt, 0);

        _submit(-5, uint32(block.timestamp), REGULAR); // a bad/negative mid never becomes a price
        (uint256 px2,) = oracle.priceWad(FEED);
        assertEq(px2, 0, "negative mid ignored");
    }

    function test_only_updater_can_submit() public {
        vm.expectRevert(ChainlinkStreamsEquityOracle.NotUpdater.selector);
        oracle.updateReport(_payload(FEED, 100e18, uint32(block.timestamp), REGULAR));
    }

    function test_unregistered_feed_rejected() public {
        vm.prank(updater);
        vm.expectRevert(ChainlinkStreamsEquityOracle.FeedNotActive.selector);
        oracle.updateReport(_payload(bytes32("TSLA"), 100e18, uint32(block.timestamp), REGULAR));
    }

    function test_deactivated_feed_rejected() public {
        oracle.registerFeed(FEED, 18, false);
        vm.prank(updater);
        vm.expectRevert(ChainlinkStreamsEquityOracle.FeedNotActive.selector);
        oracle.updateReport(_payload(FEED, 100e18, uint32(block.timestamp), REGULAR));
    }

    function test_unset_feed_returns_zero() public view {
        (uint256 px, uint256 updatedAt) = oracle.priceWad(bytes32("MSFT"));
        assertEq(px, 0);
        assertEq(updatedAt, 0);
    }

    function test_setters_guard_zero_and_owner() public {
        vm.expectRevert(ChainlinkStreamsEquityOracle.BadConfig.selector);
        oracle.setUpdater(address(0));

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        oracle.setUpdater(address(0xCAFE));
    }
}
