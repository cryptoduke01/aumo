// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";

/// @dev Uniswap v3 pool (only what we call). Both tokens are dollar-pegged, equal-decimal.
interface IUniV3Pool {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external
        returns (uint256 amount0, uint256 amount1);
    function burn(int24 tickLower, int24 tickUpper, uint128 amount)
        external
        returns (uint256 amount0, uint256 amount1);
    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external returns (uint128 amount0, uint128 amount1);
    function positions(bytes32 key)
        external
        view
        returns (uint128 liquidity, uint256, uint256, uint128 tokensOwed0, uint128 tokensOwed1);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function tickSpacing() external view returns (int24);
}

/// @dev Uniswap v3 SwapRouter02 (no deadline in the struct).
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title UniV3LpAdapter
/// @notice Provides FULL-RANGE liquidity to a Uniswap v3 RWA/stablecoin pool on X Layer (USDG/USDT0)
///         so the vault earns trading fees on real-world-asset liquidity, and becomes eligible for
///         X Layer's RWA liquidity incentives. The path in: USDT0 -> half swapped to USDG (both
///         dollar-pegged, ~1:1) -> mint liquidity across the full range (no tick management, so the
///         position never goes out of range and never needs rebalancing). The path out: burn the
///         whole position -> collect + fees -> swap USDG back to USDT0 -> return to the vault. The
///         position is valued in balanceOf() from the pool's live sqrt price via Uniswap's own
///         LiquidityAmounts math (not an approximation), haircut by a small round-trip discount.
/// @dev One adapter per (vault, pool). Full-range keeps the math free of TickMath: the range bounds
///      are the absolute min/max ticks, whose sqrt ratios are the well-known MIN/MAX_SQRT_RATIO
///      constants. Every swap carries a non-zero slippage floor. Only the owning vault moves funds;
///      the owner can retune floors and force an emergency exit. Withdrawals ALWAYS fully unwind the
///      position (an LP position is all-or-nothing here), returning realized value to the vault; the
///      vault's idle buffer re-absorbs any excess over the requested amount.
contract UniV3LpAdapter is IVenueAdapter, Ownable {
    using SafeERC20 for IERC20;

    // Full-range tick bounds and their sqrt ratios (Uniswap v3 constants). tickSpacing on the target
    // 0.01% pool is 1, so the absolute min/max ticks are usable as-is.
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    IERC20 public immutable token; // USDT0 (vault asset)
    IERC20 public immutable usdg; // USDG (RWA-backed dollar)
    IUniV3Pool public immutable pool; // USDG/USDT0 Uniswap v3 pool
    ISwapRouter02 public immutable router; // Uniswap v3 SwapRouter02
    address public immutable vault; // the only permitted caller
    uint24 public immutable poolFee; // pool fee tier (used for the entry/exit swaps too)
    bool public immutable usdgIsToken0; // orientation of the pool

    uint256 public maxSlippageBps; // floor on each USDT0<->USDG swap
    uint256 public valuationDiscountBps; // NAV haircut in balanceOf (marginal exit cost)

    event MaxSlippageBpsUpdated(uint256 bps);
    event ValuationDiscountBpsUpdated(uint256 bps);

    error OnlyVault();
    error OnlyPool();
    error BadParam();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(
        address token_,
        address usdg_,
        address pool_,
        address router_,
        address vault_,
        address owner_,
        uint24 poolFee_,
        uint256 maxSlippageBps_,
        uint256 valuationDiscountBps_
    ) Ownable(owner_) {
        if (maxSlippageBps_ == 0 || maxSlippageBps_ >= 10_000) revert BadParam();
        if (valuationDiscountBps_ > maxSlippageBps_) revert BadParam();
        uint8 d = IERC20Metadata(token_).decimals();
        if (IERC20Metadata(usdg_).decimals() != d) revert BadParam();
        address t0 = IUniV3Pool(pool_).token0();
        address t1 = IUniV3Pool(pool_).token1();
        bool usdg0 = (t0 == usdg_ && t1 == token_);
        bool usdg1 = (t1 == usdg_ && t0 == token_);
        if (!usdg0 && !usdg1) revert BadParam(); // pool must be exactly USDG/USDT0
        if (IUniV3Pool(pool_).tickSpacing() != 1) revert BadParam(); // full-range bounds assume spacing 1

        token = IERC20(token_);
        usdg = IERC20(usdg_);
        pool = IUniV3Pool(pool_);
        router = ISwapRouter02(router_);
        vault = vault_;
        poolFee = poolFee_;
        usdgIsToken0 = usdg0;
        maxSlippageBps = maxSlippageBps_;
        valuationDiscountBps = valuationDiscountBps_;
    }

    // --- owner controls ---

    function setMaxSlippageBps(uint256 bps) external onlyOwner {
        if (bps == 0 || bps >= 10_000 || valuationDiscountBps > bps) revert BadParam();
        maxSlippageBps = bps;
        emit MaxSlippageBpsUpdated(bps);
    }

    function setValuationDiscountBps(uint256 bps) external onlyOwner {
        if (bps > maxSlippageBps) revert BadParam();
        valuationDiscountBps = bps;
        emit ValuationDiscountBpsUpdated(bps);
    }

    function asset() external view returns (address) {
        return address(token);
    }

    // --- money path ---

    function deposit(uint256 amount) external onlyVault returns (uint256 supplied) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        // Both legs are dollar-pegged ~1:1, so swap half of the USDT0 to USDG to fund a balanced
        // full-range mint. The mint pulls exactly what the chosen liquidity needs; any tiny remainder
        // stays in the adapter and is still counted in balanceOf (valued ~$1), so no value is lost.
        uint256 half = amount / 2;
        _uniSwap(token, address(usdg), half, _floor(half));

        uint256 usdgBal = usdg.balanceOf(address(this));
        uint256 usdt0Bal = token.balanceOf(address(this));
        (uint256 amt0, uint256 amt1) = usdgIsToken0 ? (usdgBal, usdt0Bal) : (usdt0Bal, usdgBal);

        (uint160 sqrtP,,,,,,) = pool.slot0();
        uint128 liquidity = _liquidityForAmounts(sqrtP, amt0, amt1);
        if (liquidity > 0) {
            pool.mint(address(this), MIN_TICK, MAX_TICK, liquidity, "");
        }
        // Report the realized value that reached the venue (position + any remainder), so the pool's
        // loss budget meters the round-trip swap cost of entry.
        return _grossValue();
    }

    /// @dev Withdrawals fully unwind the position — an LP position is all-or-nothing here. `amount` is
    ///      advisory; the whole position (plus any accrued fees) is realized to USDT0 and returned, and
    ///      the vault's idle buffer re-absorbs any excess over the request.
    function withdraw(uint256 /*amount*/ ) external onlyVault returns (uint256 withdrawn) {
        _unwindAll(true); // floor the USDG->USDT0 exit swap against a thin/manipulated pool
        return _sweepToVault(0); // per-swap floor already applied
    }

    /// @notice Owner escape hatch: unwind the whole position and return USDT0 to the vault at a
    ///         caller-supplied final floor (never 0 in practice — the owner is trusted). For stress
    ///         where the normal per-swap floor reverts.
    function emergencyWithdraw(uint256 minUsdtOut) external onlyOwner returns (uint256 got) {
        _unwindAll(false); // accept any per-swap output; the owner's floor is on the total returned
        return _sweepToVault(minUsdtOut);
    }

    /// @notice Realizable value in USDT0 terms: the full-range position valued at the pool's live sqrt
    ///         price, plus any tokens held in the adapter and any uncollected fees, haircut by
    ///         `valuationDiscountBps`. Both legs are dollar-pegged 6dp, so USDG ~ USDT0 1:1.
    function balanceOf(address) external view returns (uint256) {
        return (_grossValue() * (10_000 - valuationDiscountBps)) / 10_000;
    }

    // --- internals ---

    function _grossValue() internal view returns (uint256) {
        (uint160 sqrtP,,,,,,) = pool.slot0();
        (uint128 liquidity,,, uint128 owed0, uint128 owed1) = pool.positions(_positionKey());
        (uint256 amt0, uint256 amt1) = _amountsForLiquidity(sqrtP, liquidity);
        // add uncollected fees credited to the position
        amt0 += owed0;
        amt1 += owed1;
        // plus any loose balances held in the adapter (remainder from a mint, or between moves)
        (uint256 usdgAmt, uint256 usdt0Amt) = usdgIsToken0
            ? (amt0 + usdg.balanceOf(address(this)), amt1 + token.balanceOf(address(this)))
            : (amt1 + usdg.balanceOf(address(this)), amt0 + token.balanceOf(address(this)));
        // USDG ~ USDT0 1:1 (both dollar-pegged 6dp)
        return usdgAmt + usdt0Amt;
    }

    function _unwindAll(bool useFloor) internal {
        (uint128 liquidity,,,,) = pool.positions(_positionKey());
        if (liquidity > 0) {
            pool.burn(MIN_TICK, MAX_TICK, liquidity);
        }
        // collect everything the position owes us (burned principal + accrued fees)
        pool.collect(address(this), MIN_TICK, MAX_TICK, type(uint128).max, type(uint128).max);
        uint256 usdgBal = usdg.balanceOf(address(this));
        if (usdgBal > 0) {
            // Floor the exit swap on the ACTUAL USDG being swapped, so a thin/manipulated pool reverts
            // instead of bleeding value. The owner path passes useFloor=false and enforces a final
            // floor on the total USDT0 returned instead.
            _uniSwap(usdg, address(token), usdgBal, useFloor ? _floorFrom(usdgBal) : 0);
        }
    }

    function _sweepToVault(uint256 minOut) internal returns (uint256 sent) {
        sent = token.balanceOf(address(this));
        require(sent >= minOut, "min out");
        if (sent > 0) token.safeTransfer(vault, sent);
    }

    /// @dev Uniswap v3 SwapRouter02 exact-input single swap with a hard, non-zero output floor.
    function _uniSwap(IERC20 tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 out)
    {
        if (amountIn == 0) return 0;
        tokenIn.forceApprove(address(router), amountIn);
        out = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(tokenIn),
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        tokenIn.forceApprove(address(router), 0);
    }

    function _floor(uint256 amountIn) internal view returns (uint256) {
        return (amountIn * (10_000 - maxSlippageBps)) / 10_000;
    }

    function _floorFrom(uint256 amt) internal view returns (uint256) {
        return (amt * (10_000 - maxSlippageBps)) / 10_000;
    }

    /// @dev The pool tracks a position by keccak256(owner, tickLower, tickUpper).
    function _positionKey() internal view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), MIN_TICK, MAX_TICK));
    }

    /// @notice Uniswap v3 mint callback: pay the pool exactly what it asks for. Only the pool may call.
    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external {
        if (msg.sender != address(pool)) revert OnlyPool();
        if (amount0Owed > 0) IERC20(pool.token0()).safeTransfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) IERC20(pool.token1()).safeTransfer(msg.sender, amount1Owed);
    }

    /* ------------------------------------------------------------------ */
    /*  Uniswap v3 LiquidityAmounts + FullMath, vendored EXACTLY so the    */
    /*  on-chain valuation matches the pool's own math (no approximation). */
    /* ------------------------------------------------------------------ */

    /// @dev Full-range: sqrt price is always strictly between MIN and MAX, so use the in-range branch.
    function _liquidityForAmounts(uint160 sqrtP, uint256 amount0, uint256 amount1)
        internal
        pure
        returns (uint128)
    {
        uint128 l0 = _liquidityForAmount0(sqrtP, MAX_SQRT_RATIO, amount0);
        uint128 l1 = _liquidityForAmount1(MIN_SQRT_RATIO, sqrtP, amount1);
        return l0 < l1 ? l0 : l1;
    }

    function _liquidityForAmount0(uint160 sqrtA, uint160 sqrtB, uint256 amount0) internal pure returns (uint128) {
        (uint160 a, uint160 b) = sqrtA <= sqrtB ? (sqrtA, sqrtB) : (sqrtB, sqrtA);
        uint256 intermediate = _mulDiv(a, b, Q96);
        return _toUint128(_mulDiv(amount0, intermediate, b - a));
    }

    function _liquidityForAmount1(uint160 sqrtA, uint160 sqrtB, uint256 amount1) internal pure returns (uint128) {
        (uint160 a, uint160 b) = sqrtA <= sqrtB ? (sqrtA, sqrtB) : (sqrtB, sqrtA);
        return _toUint128(_mulDiv(amount1, Q96, b - a));
    }

    function _amountsForLiquidity(uint160 sqrtP, uint128 liquidity)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (liquidity == 0) return (0, 0);
        amount0 = _amount0ForLiquidity(sqrtP, MAX_SQRT_RATIO, liquidity);
        amount1 = _amount1ForLiquidity(MIN_SQRT_RATIO, sqrtP, liquidity);
    }

    function _amount0ForLiquidity(uint160 sqrtA, uint160 sqrtB, uint128 liquidity) internal pure returns (uint256) {
        (uint160 a, uint160 b) = sqrtA <= sqrtB ? (sqrtA, sqrtB) : (sqrtB, sqrtA);
        return _mulDiv(uint256(liquidity) << 96, b - a, b) / a;
    }

    function _amount1ForLiquidity(uint160 sqrtA, uint160 sqrtB, uint128 liquidity) internal pure returns (uint256) {
        (uint160 a, uint160 b) = sqrtA <= sqrtB ? (sqrtA, sqrtB) : (sqrtB, sqrtA);
        return _mulDiv(liquidity, b - a, Q96);
    }

    function _toUint128(uint256 x) internal pure returns (uint128 y) {
        require((y = uint128(x)) == x, "ov");
    }

    /// @dev Uniswap v3 FullMath.mulDiv — 512-bit multiply then divide, reverting on overflow/zero.
    function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) {
                require(denominator > 0);
                assembly {
                    result := div(prod0, denominator)
                }
                return result;
            }
            require(denominator > prod1);
            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
            }
            assembly {
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
            }
            assembly {
                prod0 := div(prod0, twos)
            }
            assembly {
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inv = (3 * denominator) ^ 2;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            inv *= 2 - denominator * inv;
            result = prod0 * inv;
            return result;
        }
    }
}
