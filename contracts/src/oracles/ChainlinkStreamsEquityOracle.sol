// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IEquityOracle} from "../interfaces/IEquityOracle.sol";
import {IVerifierProxy} from "../interfaces/IVerifierProxy.sol";

/// @title ChainlinkStreamsEquityOracle
/// @notice Production [[IEquityOracle]] backed by Chainlink Data Streams — the equity price source
///         live on X Layer (OKX, Jun 2026: 24/5 US equities incl. NVDA/TSLA/AAPL, plus tokenized
///         treasuries and commodities). Data Streams is PULL-based: an off-chain report is fetched
///         and its DON signatures are checked on-chain by the VerifierProxy. A trusted `updater`
///         (the Aumo agent, or a Chainlink Automation upkeep) submits a fresh verified report each
///         cycle via {updateReport}; NAV and trade-time reads then use the stored value through the
///         plain {priceWad} view, so pricing never needs a signed report inline on every read.
///
///         MARKET HOURS COME FROM THE DON, NOT A GUESS. The RWA Advanced (v11) report carries an
///         explicit `marketStatus` (for 24/5 equities: 0 Unknown, 1 Pre-market, 2 Regular, 3
///         Post-market, 4 Overnight, 5 Closed). This oracle treats only the tradeable states as
///         "open" and, for every other state, reports `updatedAt = 0` from {priceWad}. That makes
///         the equity adapter's freshness guard and the equity pool's `marketOpen()` refuse to
///         trade or to admit/redeem while the market is not open — with NO change to either — while
///         NAV reads keep using the last published price. Staleness is a second, independent guard:
///         if the updater stops submitting, the stored timestamp ages past the consumer's maxAge and
///         everything fails closed regardless of the last status.
///
///         DEPLOY-TIME / MAINNET-PHASE (must be confirmed against Chainlink's canonical library and
///         a fork test on live X Layer before mainnet, tracked in EQUITY-SOAK.md): the live X Layer
///         VerifierProxy address, the per-asset stream (feed) IDs, each feed's price decimals, and
///         the exact v11 field order/types below. The verify/decode/scale/fold LOGIC here is what
///         the unit suite proves; the wire format is the immutable to lock at mainnet.
contract ChainlinkStreamsEquityOracle is IEquityOracle, Ownable2Step {
    /// @dev RWA Advanced (v11) report, as documented for 24/5 US equities. Field order and types are
    ///      transcribed from the Chainlink docs and MUST be re-confirmed against the canonical
    ///      StreamsLib before mainnet; the mock verifier in tests encodes this same struct, so the
    ///      unit suite proves the decode/scale/fold logic, not the production wire format.
    struct ReportV11 {
        bytes32 feedId;
        uint32 validFromTimestamp;
        uint32 observationsTimestamp;
        uint192 nativeFee;
        uint192 linkFee;
        uint32 expiresAt;
        int192 mid; // DON consensus median price, in the feed's own decimals
        uint64 lastSeenTimestampNs;
        int192 bid;
        int192 bidVolume;
        int192 ask;
        int192 askVolume;
        int192 lastTradedPrice;
        uint32 marketStatus;
    }

    // 24/5 US equities marketStatus values (0 Unknown / 5 Closed are never tradeable).
    uint32 private constant STATUS_PRE = 1;
    uint32 private constant STATUS_REGULAR = 2;
    uint32 private constant STATUS_POST = 3;
    uint32 private constant STATUS_OVERNIGHT = 4;

    uint256 private constant WAD = 1e18;

    IVerifierProxy public verifierProxy; // Data Streams onchain verifier
    address public updater; // the only address permitted to submit reports (agent / Automation)
    // Trading window, dialable up from regular-hours-only toward the full 24/5 weekday coverage the
    // equity streams provide. Regular hours are always tradeable. Extended = pre + post-market.
    // Overnight (8pm-4am ET) is the thinnest session, so it is its own opt-in; even off, the adapter's
    // slippage guard would refuse a bad overnight fill anyway. Weekends have no price at all (status
    // Closed) and are never tradeable, by design — that is the market-hours freeze, not a gap.
    bool public allowExtendedHours; // pre- and post-market
    bool public allowOvernight; // overnight session

    struct Feed {
        bool active;
        uint8 decimals; // decimals of `mid` in this feed's reports (8 or 18)
    }

    struct Stored {
        uint256 priceWad; // last mid scaled to 1e18
        uint32 observationsTimestamp;
        uint32 marketStatus;
    }

    mapping(bytes32 => Feed) private _feeds;
    mapping(bytes32 => Stored) private _stored;

    event VerifierProxyUpdated(address indexed verifierProxy);
    event UpdaterUpdated(address indexed updater);
    event ExtendedHoursSet(bool allowed);
    event OvernightSet(bool allowed);
    event FeedRegistered(bytes32 indexed feedId, uint8 decimals, bool active);
    event ReportStored(bytes32 indexed feedId, uint256 priceWad, uint32 observationsTimestamp, uint32 marketStatus);

    error NotUpdater();
    error FeedNotActive();
    error BadConfig();

    constructor(address verifierProxy_, address updater_, address owner_) Ownable(owner_) {
        if (verifierProxy_ == address(0) || updater_ == address(0)) revert BadConfig();
        verifierProxy = IVerifierProxy(verifierProxy_);
        updater = updater_;
        emit VerifierProxyUpdated(verifierProxy_);
        emit UpdaterUpdated(updater_);
    }

    // --------------------------------------------------------------------------- owner: config

    function setVerifierProxy(address verifierProxy_) external onlyOwner {
        if (verifierProxy_ == address(0)) revert BadConfig();
        verifierProxy = IVerifierProxy(verifierProxy_);
        emit VerifierProxyUpdated(verifierProxy_);
    }

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

    /// @notice Register (or deactivate) a stream. `decimals` is the decimals of `mid` in that feed's
    ///         reports (Data Streams equity mid is 8 or 18 dp). Only registered, active feeds accept
    ///         reports and return a price.
    function registerFeed(bytes32 feedId, uint8 decimals, bool active) external onlyOwner {
        if (decimals == 0 || decimals > 18) revert BadConfig();
        _feeds[feedId] = Feed({active: active, decimals: decimals});
        emit FeedRegistered(feedId, decimals, active);
    }

    function feedInfo(bytes32 feedId) external view returns (bool active, uint8 decimals) {
        Feed memory f = _feeds[feedId];
        return (f.active, f.decimals);
    }

    // --------------------------------------------------------------------------- updater: submit

    /// @notice Verify a fetched Data Streams report and store its price + market status. Subscription
    ///         billing means no fee/approval and an empty `parameterPayload`. Only the trusted updater
    ///         may call; a malformed report simply reverts the submission (no bad price is stored).
    function updateReport(bytes calldata payload) external {
        if (msg.sender != updater) revert NotUpdater();
        bytes memory verified = verifierProxy.verify(payload, bytes(""));
        ReportV11 memory r = abi.decode(verified, (ReportV11));

        Feed memory f = _feeds[r.feedId];
        if (!f.active) revert FeedNotActive();

        uint256 pxWad = r.mid > 0 ? (uint256(uint192(r.mid)) * WAD) / (10 ** f.decimals) : 0;
        _stored[r.feedId] =
            Stored({priceWad: pxWad, observationsTimestamp: r.observationsTimestamp, marketStatus: r.marketStatus});
        emit ReportStored(r.feedId, pxWad, r.observationsTimestamp, r.marketStatus);
    }

    // --------------------------------------------------------------------------- IEquityOracle

    /// @inheritdoc IEquityOracle
    /// @dev Returns the last stored mid (WAD). `updatedAt` is the report's observation time WHEN the
    ///      market is in a tradeable state, else 0 — so a closed/pre/post/overnight/unknown market
    ///      reads as stale to callers and they refuse to trade, while NAV reads still see the price.
    function priceWad(bytes32 feedId) external view returns (uint256 price, uint256 updatedAt) {
        Stored memory s = _stored[feedId];
        if (s.priceWad == 0) return (0, 0);
        return (s.priceWad, _tradeable(s.marketStatus) ? uint256(s.observationsTimestamp) : 0);
    }

    /// @notice Whether the last report's market status is one Aumo will trade in. Regular hours
    ///         always; pre- and post-market only if the owner opted in; never overnight/closed/unknown.
    function marketTradeable(bytes32 feedId) external view returns (bool) {
        return _tradeable(_stored[feedId].marketStatus);
    }

    function _tradeable(uint32 marketStatus) internal view returns (bool) {
        if (marketStatus == STATUS_REGULAR) return true;
        if (allowExtendedHours && (marketStatus == STATUS_PRE || marketStatus == STATUS_POST)) return true;
        if (allowOvernight && marketStatus == STATUS_OVERNIGHT) return true;
        return false;
    }
}
