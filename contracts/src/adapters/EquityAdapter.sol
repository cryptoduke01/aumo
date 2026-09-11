// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";
import {IEquityOracle} from "../interfaces/IEquityOracle.sol";

/// @dev Minimal slice of the Uniswap v3 SwapRouter02 used by this adapter. Path-based `exactInput`
///      handles both a single direct pool and a multi-hop route (e.g. USD₮0 -> USDG -> xStock), so
///      the same adapter works whether the base asset pairs with the xStock directly or has to be
///      routed through USDG (X Layer's funnel stablecoin, where the tokenized-stock liquidity lives).
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @title EquityAdapter
/// @notice A DIRECTIONAL, at-risk venue adapter. It converts the base asset (USD₮0) into a
///         tokenized equity (an xStock, e.g. NVDAx) and back, so an OPT-IN equity pool can hold
///         the price exposure a depositor deliberately chose. This is NOT capital preservation:
///         the position's value moves with the stock, and depositors in the pool that uses this
///         adapter bear that price risk. It must never be allowlisted on the safe treasury pool.
///
///         Every buy and sell is guarded by an independent equity oracle ([[IEquityOracle]]):
///           1. Freshness / market hours — the equity feed only updates while the market is open
///              (about five days a week), so a stale price is the market-closed signal and the
///              adapter refuses to trade rather than transacting on a blind price.
///           2. Manipulation bound — every swap carries an oracle-derived `amountOutMinimum`, so a
///              manipulated pool cannot fill the trade at a price meaningfully worse than the
///              independent oracle's. A hollowed-out or spoofed pool makes the swap revert, it does
///              not drain the position.
///
///         Only the owning (equity) vault may move funds; withdrawals go straight back to it.
contract EquityAdapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token; // base asset (USD₮0)
    IERC20 public immutable stock; // the tokenized equity (xStock)
    IEquityOracle public immutable oracle; // independent equity price source
    bytes32 public immutable feedId; // oracle feed id for `stock`
    ISwapRouter02 public immutable router; // Uniswap v3 SwapRouter02
    address public immutable vault; // the only permitted caller (the opt-in equity pool)

    // v3 swap paths (token,fee,token[,fee,token...]). `buyPath` routes base asset -> xStock and
    // `sellPath` is its reverse (xStock -> base asset). Single hop is a one-pool path; multi-hop
    // (e.g. USD₮0 -> USDG -> xStock) is the same struct with an extra hop. Set once at construction.
    bytes public buyPath;
    bytes public sellPath;

    uint256 public immutable maxAge; // seconds: older than this = market closed = refuse to trade
    uint256 public immutable slippageBps; // max acceptable slippage vs the oracle price (bps)

    uint8 private immutable _tokenDec; // USD₮0 decimals (6)
    uint8 private immutable _stockDec; // xStock decimals

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant DUST = 1e3; // ~0.001 USD₮0 (6dp): treat a request this close to the whole
        // position as a full retreat, so decimal rounding never leaves the caller a wei short

    error OnlyVault();
    error StalePrice();
    error ZeroPrice();
    error BadConfig();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(
        address token_,
        address stock_,
        address oracle_,
        bytes32 feedId_,
        address router_,
        address vault_,
        bytes memory buyPath_,
        bytes memory sellPath_,
        uint256 maxAge_,
        uint256 slippageBps_
    ) {
        if (
            token_ == address(0) || stock_ == address(0) || oracle_ == address(0) || router_ == address(0)
                || vault_ == address(0) || maxAge_ == 0 || slippageBps_ == 0 || slippageBps_ >= BPS
        ) revert BadConfig();
        // The buy path must start at the base asset and end at the stock; the sell path is its mirror.
        // This binds the routing to the exact tokens the pricing math uses, so a mis-encoded path (or
        // one that would leave funds in the wrong token) can never be deployed.
        if (!_wellFormed(buyPath_) || !_wellFormed(sellPath_)) revert BadConfig();
        if (_firstToken(buyPath_) != token_ || _lastToken(buyPath_) != stock_) revert BadConfig();
        if (_firstToken(sellPath_) != stock_ || _lastToken(sellPath_) != token_) revert BadConfig();

        token = IERC20(token_);
        stock = IERC20(stock_);
        oracle = IEquityOracle(oracle_);
        feedId = feedId_;
        router = ISwapRouter02(router_);
        vault = vault_;
        buyPath = buyPath_;
        sellPath = sellPath_;
        maxAge = maxAge_;
        slippageBps = slippageBps_;
        _tokenDec = IERC20Metadata(token_).decimals();
        _stockDec = IERC20Metadata(stock_).decimals();
    }

    function asset() external view returns (address) {
        return address(token);
    }

    /// @notice Buy `amount` USD₮0 worth of the stock, refusing on a stale (market-closed) price and
    ///         requiring the swap to fill at no worse than the oracle price minus `slippageBps`.
    function deposit(uint256 amount) external onlyVault returns (uint256 supplied) {
        if (amount == 0) return 0;
        uint256 px = _freshPriceWad(); // reverts if stale / zero
        token.safeTransferFrom(msg.sender, address(this), amount);

        // expected stock out = (USD value of `amount`) / price, carried through decimals
        uint256 expStock = _usdToStock(_tokenToUsdWad(amount), px);
        uint256 minOut = (expStock * (BPS - slippageBps)) / BPS;

        token.forceApprove(address(router), amount);
        router.exactInput(
            ISwapRouter02.ExactInputParams({
                path: buyPath,
                recipient: address(this),
                amountIn: amount,
                amountOutMinimum: minOut
            })
        );
        token.forceApprove(address(router), 0); // never leave a standing allowance
        return amount;
    }

    /// @notice Sell enough of the held stock to return ~`amount` USD₮0 to the vault (capped at the
    ///         whole position for a full retreat), guarded by the same freshness + slippage bound.
    function withdraw(uint256 amount) external onlyVault returns (uint256 withdrawn) {
        uint256 held = stock.balanceOf(address(this));
        if (held == 0 || amount == 0) return 0;
        uint256 px = _freshPriceWad();

        // Whole position's value in USD₮0. If the request meets or exceeds it (a full retreat, incl.
        // amount == type(uint256).max) OR lands within DUST of it, sell everything; otherwise size the
        // sell to `amount`, rounding the units UP so the realized USD₮0 is >= `amount` despite the two
        // decimal conversions flooring. Comparing before any `amount * ...` avoids overflowing on a
        // max-value request, and `fullValue - amount` is only evaluated when amount < fullValue.
        uint256 fullValue = _stockToToken(held, px);
        uint256 sellUnits;
        if (amount >= fullValue || fullValue - amount <= DUST) {
            sellUnits = held;
        } else {
            sellUnits = _usdToStockCeil(_tokenToUsdWad(amount), px);
            if (sellUnits > held) sellUnits = held; // never sell more than we hold
        }
        if (sellUnits == 0) return 0; // dust request rounds to nothing; never swap 0 in

        uint256 minUsdt = (_stockToToken(sellUnits, px) * (BPS - slippageBps)) / BPS;

        stock.forceApprove(address(router), sellUnits);
        uint256 out = router.exactInput(
            ISwapRouter02.ExactInputParams({
                path: sellPath,
                recipient: msg.sender, // straight back to the vault
                amountIn: sellUnits,
                amountOutMinimum: minUsdt
            })
        );
        stock.forceApprove(address(router), 0);
        return out;
    }

    /// @notice Live value of the position in USD₮0 terms (stock held x oracle price). NAV reads use
    ///         the last published price and never revert, so a stale feed does not brick the pool's
    ///         accounting; trade-time freshness is enforced in deposit/withdraw.
    function balanceOf(address) external view returns (uint256) {
        uint256 held = stock.balanceOf(address(this));
        if (held == 0) return 0;
        (uint256 px,) = oracle.priceWad(feedId);
        if (px == 0) return 0;
        return _stockToToken(held, px);
    }

    // --------------------------------------------------------------- internal math (decimals-safe)

    function _freshPriceWad() internal view returns (uint256 px) {
        uint256 updatedAt;
        (px, updatedAt) = oracle.priceWad(feedId);
        if (px == 0) revert ZeroPrice();
        if (block.timestamp - updatedAt > maxAge) revert StalePrice();
    }

    /// @dev USD₮0 amount (tokenDec) -> USD value, WAD (assumes USD₮0 ~ $1).
    function _tokenToUsdWad(uint256 tokenAmt) internal view returns (uint256) {
        return (tokenAmt * WAD) / (10 ** _tokenDec);
    }

    /// @dev USD value (WAD) at price `pxWad` (USD/share, WAD) -> stock units (stockDec), rounding down.
    function _usdToStock(uint256 usdWad, uint256 pxWad) internal view returns (uint256) {
        return (usdWad * (10 ** _stockDec)) / pxWad;
    }

    /// @dev Same conversion rounding UP, so a sell sized to return `amount` never realizes short.
    function _usdToStockCeil(uint256 usdWad, uint256 pxWad) internal view returns (uint256) {
        uint256 num = usdWad * (10 ** _stockDec);
        return (num + pxWad - 1) / pxWad;
    }

    /// @dev stock units (stockDec) at price `pxWad` -> USD₮0 amount (tokenDec).
    function _stockToToken(uint256 stockUnits, uint256 pxWad) internal view returns (uint256) {
        uint256 usdWad = (stockUnits * pxWad) / (10 ** _stockDec);
        return (usdWad * (10 ** _tokenDec)) / WAD;
    }

    // ------------------------------------------------------------------ v3 path parsing (constructor)

    /// @dev A Uniswap v3 path is `token (20) + [fee (3) + token (20)] * hops`. Well-formed means at
    ///      least one hop and an exact number of whole hops, so the first/last 20 bytes are real
    ///      token addresses and the router can walk it.
    function _wellFormed(bytes memory path) private pure returns (bool) {
        uint256 len = path.length;
        return len >= 43 && (len - 20) % 23 == 0;
    }

    function _firstToken(bytes memory path) private pure returns (address a) {
        assembly {
            a := shr(96, mload(add(path, 0x20)))
        }
    }

    function _lastToken(bytes memory path) private pure returns (address a) {
        uint256 len = path.length;
        assembly {
            a := shr(96, mload(add(add(path, 0x20), sub(len, 20))))
        }
    }
}
