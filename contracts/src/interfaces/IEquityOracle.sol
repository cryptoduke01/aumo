// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IEquityOracle
/// @notice Oracle-agnostic price source for a tokenized equity (an xStock). One `feedId` per
///         asset. Implementations wrap whatever X Layer actually offers — Chainlink Data Streams
///         or Data Feeds (live on X Layer, covering TSLA/NVDA/AAPL and more), or Supra. Pyth is
///         NOT deployed on X Layer, so nothing in this interface is Pyth-specific.
/// @dev `price` is USD per whole share scaled to 1e18 (WAD). `updatedAt` is the feed's own
///      publish time. The equity feeds only update while the underlying market is open (about five
///      days a week), so a stale `updatedAt` is precisely the "market closed" signal the equity
///      adapter refuses to trade on. Reads are non-reverting so a NAV view never bricks the pool;
///      freshness is enforced by the caller at trade time.
interface IEquityOracle {
    /// @param feedId identifier for the equity (e.g. keccak/feed id for NVDA)
    /// @return price USD per share, 1e18-scaled (0 if unknown)
    /// @return updatedAt unix seconds the price was last published
    function priceWad(bytes32 feedId) external view returns (uint256 price, uint256 updatedAt);
}
