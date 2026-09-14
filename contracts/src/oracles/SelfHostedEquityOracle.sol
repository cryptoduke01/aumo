// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IEquityOracle} from "../interfaces/IEquityOracle.sol";

/// @title SelfHostedEquityOracle
/// @notice A self-sourced [[IEquityOracle]] for tokenized equities (xStocks), for the phase before an
///         enterprise price network (Chainlink Data Streams / Supra) is available for equities on X
///         Layer. An off-chain feeder pulls quotes from a market-data API (Finnhub, with a secondary
///         source for coverage/gaps), scales USD-per-share to 1e18, resolves the US market session,
///         and submits both here through a single trusted `updater` key. The consumer contracts do
///         not change: NAV and trade-time reads go through the same {priceWad} view, and the market
///         session folds into `updatedAt` exactly as in the Chainlink oracle, so the equity adapter's
///         freshness guard and the equity pool's `marketOpen()` refuse to trade or admit/redeem while
///         the market is not open, with NO change to either.
///
///         TRUST MODEL, STATED HONESTLY. Unlike the Data Streams oracle, prices here are NOT verified
///         on-chain against a decentralized DON — the `updater` key IS the source of truth. That is a
///         weaker guarantee, and it is disclosed to depositors on the product page. This is a
///         deliberate, migratable v1: consumers read through the oracle-agnostic {IEquityOracle}, so
///         swapping to the Data Streams / Supra oracle later is a single `setOracle` on the adapter,
///         no depositor action. To bound the damage a bad feed or a compromised key can do while this
///         is the source, the submit path enforces: a registered-feed allowlist, a monotonic
///         observation timestamp (no replay or rollback to an old price), a future-skew bound, an
///         absurd-price cap, and an owner-dialable per-update deviation circuit-breaker. None of these
///         make a single key trustless; they make an honest v1 fail loud instead of silent.
///
///         MARKET SESSION comes from the feeder, not a guess: it sets `marketStatus` per the same 24/5
///         convention the equity streams use (0 Unknown, 1 Pre, 2 Regular, 3 Post, 4 Overnight, 5
///         Closed) from the data source's own market-status signal. Only tradeable states read as
///         "open"; every other state reports `updatedAt = 0` so callers fail closed at trade time
///         while NAV keeps using the last published price. Staleness is the second, independent guard:
///         if the feeder stops, the stored timestamp ages past the consumer's maxAge and everything
///         fails closed regardless of the last status.
contract SelfHostedEquityOracle is IEquityOracle, Ownable2Step {
    // 24/5 US equities marketStatus values (0 Unknown / 5 Closed are never tradeable).
    uint32 private constant STATUS_PRE = 1;
    uint32 private constant STATUS_REGULAR = 2;
    uint32 private constant STATUS_POST = 3;
    uint32 private constant STATUS_OVERNIGHT = 4;

    uint256 private constant WAD = 1e18;
    // A share priced above this is a scaling/decimals mistake, not a real quote. $1,000,000/share.
    uint256 private constant MAX_PRICE_WAD = 1_000_000 * WAD;
    // Reject a report whose observation time is further ahead of the block than this (clock skew).
    uint256 private constant MAX_FUTURE_SKEW = 300; // seconds
    uint256 private constant BPS = 10_000;

    address public updater; // the only address permitted to submit prices (the Aumo feeder key)
    // Trading window, dialable up from regular-hours-only toward full 24/5 weekday coverage. Regular
    // hours are always tradeable; extended = pre + post-market; overnight is its own opt-in. Weekends
    // (status Closed) have no price and are never tradeable, by design.
    bool public allowExtendedHours;
    bool public allowOvernight;
    // Per-update deviation circuit-breaker, in bps of the last stored price. 0 disables it. When set,
    // a submission whose price moves more than this from the last stored price reverts, so a bad quote
    // or a fat-finger cannot land. Leave off for assets prone to legitimate large gaps; dial on once a
    // sane band is known. Overridable by the owner to clear a genuine gap (see {forceResync}).
    uint256 public maxDeviationBps;

    struct Feed {
        bool active;
    }

    struct Stored {
        uint256 priceWad; // last quote scaled to 1e18
        uint32 observationsTimestamp;
        uint32 marketStatus;
    }

    mapping(bytes32 => Feed) private _feeds;
    mapping(bytes32 => Stored) private _stored;

    event UpdaterUpdated(address indexed updater);
    event ExtendedHoursSet(bool allowed);
    event OvernightSet(bool allowed);
    event MaxDeviationSet(uint256 bps);
    event FeedRegistered(bytes32 indexed feedId, bool active);
    event PriceStored(bytes32 indexed feedId, uint256 priceWad, uint32 observationsTimestamp, uint32 marketStatus);

    error NotUpdater();
    error FeedNotActive();
    error BadConfig();
    error StaleObservation(); // observation time not newer than what is stored
    error FutureObservation(); // observation time too far ahead of the block
    error PriceOutOfRange(); // zero, or above the absurd-price cap
    error DeviationTooHigh(); // exceeds the circuit-breaker band

    constructor(address updater_, address owner_) Ownable(owner_) {
        if (updater_ == address(0)) revert BadConfig();
        updater = updater_;
        emit UpdaterUpdated(updater_);
    }

    // --------------------------------------------------------------------------- owner: config

    function setUpdater(address updater_) external onlyOwner {
        if (updater_ == address(0)) revert BadConfig();
        updater = updater_;
        emit UpdaterUpdated(updater_);
    }

    function setAllowExtendedHours(bool allowed) external onlyOwner {
        allowExtendedHours = allowed;
        emit ExtendedHoursSet(allowed);
    }

    /// @notice Opt the overnight session (8pm-4am ET) into the trading window. Thin-liquidity session;
    ///         off by default. The adapter's slippage bound still governs any fill either way.
    function setAllowOvernight(bool allowed) external onlyOwner {
        allowOvernight = allowed;
        emit OvernightSet(allowed);
    }

    /// @notice Set the per-update deviation circuit-breaker in bps of the last stored price (0 = off).
    function setMaxDeviationBps(uint256 bps) external onlyOwner {
        maxDeviationBps = bps;
        emit MaxDeviationSet(bps);
    }

    /// @notice Register (or deactivate) an equity feed. Only registered, active feeds accept prices and
    ///         return a value. `feedId` is the oracle-agnostic id the adapter uses for this xStock.
    function registerFeed(bytes32 feedId, bool active) external onlyOwner {
        _feeds[feedId] = Feed({active: active});
        emit FeedRegistered(feedId, active);
    }

    function feedInfo(bytes32 feedId) external view returns (bool active) {
        return _feeds[feedId].active;
    }

    // --------------------------------------------------------------------------- updater: submit

    /// @notice Submit one fresh quote. Only the trusted updater; every guard below must pass or the
    ///         whole submission reverts (no bad price is stored).
    /// @param feedId       registered equity id
    /// @param pxWad        USD per whole share, 1e18-scaled
    /// @param marketStatus 24/5 session code (0..5) resolved by the feeder from the data source
    /// @param observationsTimestamp unix seconds the quote was observed at the source
    function submitPrice(bytes32 feedId, uint256 pxWad, uint32 marketStatus, uint32 observationsTimestamp) public {
        if (msg.sender != updater) revert NotUpdater();
        if (!_feeds[feedId].active) revert FeedNotActive();
        if (pxWad == 0 || pxWad > MAX_PRICE_WAD) revert PriceOutOfRange();
        if (observationsTimestamp > block.timestamp + MAX_FUTURE_SKEW) revert FutureObservation();

        Stored memory prev = _stored[feedId];
        // Monotonic time: never accept a quote that is not strictly newer than the stored one. Blocks
        // replay of an old submission and a rollback to a stale price.
        if (observationsTimestamp <= prev.observationsTimestamp) revert StaleObservation();
        // Circuit-breaker: bound the move from the last stored price, if enabled and a price exists.
        if (maxDeviationBps != 0 && prev.priceWad != 0) {
            uint256 diff = pxWad > prev.priceWad ? pxWad - prev.priceWad : prev.priceWad - pxWad;
            if (diff * BPS > prev.priceWad * maxDeviationBps) revert DeviationTooHigh();
        }

        _stored[feedId] =
            Stored({priceWad: pxWad, observationsTimestamp: observationsTimestamp, marketStatus: marketStatus});
        emit PriceStored(feedId, pxWad, observationsTimestamp, marketStatus);
    }

    /// @notice Submit several quotes in one transaction. Atomic: any one failing guard reverts the lot,
    ///         so the pool never sees a half-updated set of xStock prices. Arrays must be equal length.
    function submitPrices(
        bytes32[] calldata feedIds,
        uint256[] calldata pricesWad,
        uint32[] calldata marketStatuses,
        uint32[] calldata observationsTimestamps
    ) external {
        uint256 n = feedIds.length;
        if (pricesWad.length != n || marketStatuses.length != n || observationsTimestamps.length != n) {
            revert BadConfig();
        }
        for (uint256 i = 0; i < n; ++i) {
            submitPrice(feedIds[i], pricesWad[i], marketStatuses[i], observationsTimestamps[i]);
        }
    }

    /// @notice Owner escape hatch to clear a stuck feed after a legitimate large gap tripped the
    ///         deviation breaker: stores the new price WITHOUT the deviation check (all other guards
    ///         still apply). Use to re-anchor after a real gap-up/down, not to bypass review.
    function forceResync(bytes32 feedId, uint256 pxWad, uint32 marketStatus, uint32 observationsTimestamp)
        external
        onlyOwner
    {
        if (!_feeds[feedId].active) revert FeedNotActive();
        if (pxWad == 0 || pxWad > MAX_PRICE_WAD) revert PriceOutOfRange();
        if (observationsTimestamp > block.timestamp + MAX_FUTURE_SKEW) revert FutureObservation();
        if (observationsTimestamp <= _stored[feedId].observationsTimestamp) revert StaleObservation();
        _stored[feedId] =
            Stored({priceWad: pxWad, observationsTimestamp: observationsTimestamp, marketStatus: marketStatus});
        emit PriceStored(feedId, pxWad, observationsTimestamp, marketStatus);
    }

    // --------------------------------------------------------------------------- IEquityOracle

    /// @inheritdoc IEquityOracle
    /// @dev Returns the last stored quote (WAD). `updatedAt` is the observation time WHEN the market is
    ///      in a tradeable state, else 0 — so a closed/pre/post/overnight/unknown market reads as stale
    ///      to callers and they refuse to trade, while NAV reads still see the price.
    function priceWad(bytes32 feedId) external view returns (uint256 price, uint256 updatedAt) {
        Stored memory s = _stored[feedId];
        if (s.priceWad == 0) return (0, 0);
        return (s.priceWad, _tradeable(s.marketStatus) ? uint256(s.observationsTimestamp) : 0);
    }

    /// @notice Whether the last quote's market status is one Aumo will trade in.
    function marketTradeable(bytes32 feedId) external view returns (bool) {
        return _tradeable(_stored[feedId].marketStatus);
    }

    /// @notice The last stored observation time and status for a feed, regardless of tradeability. Lets
    ///         the off-chain feeder skip a submission that is not newer (avoiding a doomed StaleObservation
    ///         transaction) and lets a UI show "last quote at" even while the market is closed.
    function lastObservation(bytes32 feedId) external view returns (uint32 observationsTimestamp, uint32 marketStatus) {
        Stored memory s = _stored[feedId];
        return (s.observationsTimestamp, s.marketStatus);
    }

    function _tradeable(uint32 marketStatus) internal view returns (bool) {
        if (marketStatus == STATUS_REGULAR) return true;
        if (allowExtendedHours && (marketStatus == STATUS_PRE || marketStatus == STATUS_POST)) return true;
        if (allowOvernight && marketStatus == STATUS_OVERNIGHT) return true;
        return false;
    }
}
