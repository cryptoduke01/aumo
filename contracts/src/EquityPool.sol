// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AumoPool} from "./AumoPool.sol";
import {IEquityOracle} from "./interfaces/IEquityOracle.sol";

/// @title EquityPool
/// @notice The OPT-IN, at-risk sibling of AumoPool. Depositors put in USD₮0 and receive pool shares
///         (ERC-4626), and the allowlisted agent puts that balance into a tokenized equity (an
///         xStock) through an [[EquityAdapter]] — so the pool deliberately holds directional price
///         exposure the depositor chose. This is NOT capital preservation: share value moves with
///         the stock, and every depositor bears that price risk. It reuses AumoPool's whole trust
///         model unchanged (owner sets policy, an allowlisted agent moves funds only within hard
///         caps, owner never has custody) and adds exactly two equity-specific behaviours:
///
///         1. MARKET-HOURS GATE. Entry AND exit are gated on the equity market being open, read from
///            an independent oracle's freshness (the equity feed only ticks while the market trades,
///            so a stale price is the market-closed signal). This closes the stale-NAV window: while
///            the market is shut, NAV is frozen at the last close, so allowing a deposit would mint
///            shares into a weekend price gap (diluting holders) and allowing a redemption would let
///            someone exit at a stale price ahead of a known gap (dumping the move on those who
///            stay). Freezing both until the market reopens is the same discipline a regulated fund
///            applies, and the underlying can't be traded while closed anyway. This intentionally
///            diverges from AumoPool's "redemptions never pause": that guarantee is right for a
///            stable pool whose NAV is always ~$1, and wrong for a directional pool whose NAV is
///            stale exactly when the market is closed.
///
///         2. NO CHURN-LOSS METERING ON AGENT RETREATS. AumoPool's per-epoch loss budget exists to
///            bound the USDG round-trip SPREAD a stable-pool agent can burn. Here a retreat that
///            returns less USD₮0 than principal is usually just the STOCK having fallen — a market
///            move the depositor signed up for, not agent value-destruction — so metering it would
///            wrongly block the agent from de-risking on a down day. Churn is still bounded: every
///            buy goes through the per-move / per-venue / total caps and the per-epoch DEPLOY budget,
///            and a sell can only re-stage more churn by buying again through that same budget.
contract EquityPool is AumoPool {
    /// @notice Independent oracle whose freshness is used as the market-open signal for the gate.
    IEquityOracle public marketOracle;
    /// @notice Feed id (on `marketOracle`) of a representative equity used as the market clock.
    bytes32 public marketFeedId;
    /// @notice Max age of the market-clock price before the market counts as closed (seconds).
    uint256 public marketMaxAge;

    event MarketClockUpdated(address indexed oracle, bytes32 feedId, uint256 maxAge);

    error MarketClosed();
    error BadEquityConfig();

    /// @param asset_        base asset (USD₮0)
    /// @param owner_        owner (policy + agent control; never custody)
    /// @param oracle_       independent equity oracle used as the market clock
    /// @param marketFeedId_ feed id of the representative equity (the market-open signal)
    /// @param marketMaxAge_ seconds after which a stale clock price means the market is closed
    constructor(
        IERC20 asset_,
        address owner_,
        address oracle_,
        bytes32 marketFeedId_,
        uint256 marketMaxAge_
    ) AumoPool(asset_, owner_) {
        if (oracle_ == address(0) || marketMaxAge_ == 0) revert BadEquityConfig();
        marketOracle = IEquityOracle(oracle_);
        marketFeedId = marketFeedId_;
        marketMaxAge = marketMaxAge_;
        emit MarketClockUpdated(oracle_, marketFeedId_, marketMaxAge_);
    }

    /// @dev The pool's share token is distinct from the stable pool's, and its name says at-risk.
    function name() public pure override(ERC20, IERC20Metadata) returns (string memory) {
        return "Aumo Equity Pool";
    }

    function symbol() public pure override(ERC20, IERC20Metadata) returns (string memory) {
        return "aumoEQTY";
    }

    // ------------------------------------------------------------------ market-hours gate

    /// @notice True when the market-clock price is present and fresh (the equity market is open).
    ///         NAV reads never depend on this, so a closed market never bricks share accounting; it
    ///         only gates entry and exit.
    function marketOpen() public view returns (bool) {
        (uint256 px, uint256 updatedAt) = marketOracle.priceWad(marketFeedId);
        if (px == 0) return false;
        // A future-dated timestamp (updatedAt > now) is treated as fresh, never underflowing.
        if (updatedAt >= block.timestamp) return true;
        return block.timestamp - updatedAt <= marketMaxAge;
    }

    modifier whenMarketOpen() {
        if (!marketOpen()) revert MarketClosed();
        _;
    }

    /// @notice Replace the market clock (oracle / feed / max-age). Owner-only, within the same trust
    ///         model that already lets the owner pause and impair on AumoPool — needed so a feed that
    ///         is permanently retired (not merely closed for the night) can be migrated instead of
    ///         freezing the pool forever. Does not move funds.
    function setMarketClock(address oracle_, bytes32 marketFeedId_, uint256 marketMaxAge_)
        external
        onlyOwner
    {
        if (oracle_ == address(0) || marketMaxAge_ == 0) revert BadEquityConfig();
        marketOracle = IEquityOracle(oracle_);
        marketFeedId = marketFeedId_;
        marketMaxAge = marketMaxAge_;
        emit MarketClockUpdated(oracle_, marketFeedId_, marketMaxAge_);
    }

    // ------------------------------------------------------------------ user flows (gated)

    function deposit(uint256 assets, address receiver)
        public
        override
        whenMarketOpen
        returns (uint256)
    {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenMarketOpen
        returns (uint256)
    {
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        whenMarketOpen
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        whenMarketOpen
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner);
    }

    // ------------------------------------------------------------------ agent retreat (unmetered)

    /// @notice Retreat up to `amount` from a venue back into the pool. Unlike the stable pool, agent
    ///         retreats here are NOT charged to the churn loss budget (see the contract notes): a
    ///         drawdown on exit is a market move, not agent-caused loss. Retreat is still restricted
    ///         to a venue this pool has allowlisted, and remains available while paused so the agent
    ///         can always de-risk. Deposit-side churn stays bounded by the deploy budget + caps.
    function deallocate(address venue, uint256 amount) external override onlyAgent nonReentrant {
        if (!_venueListed(venue)) revert VenueNotAllowed();
        _doDeallocate(venue, amount, false);
    }
}
