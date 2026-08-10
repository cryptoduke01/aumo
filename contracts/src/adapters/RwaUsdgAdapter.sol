// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
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

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

/// @title RwaUsdgAdapter
/// @notice Routes the vault's USDT0 into USDG — a regulated, RWA-reserve-backed dollar (Global
///         Dollar / Paxos, backed by cash and short-term U.S. Treasuries) — and supplies it to
///         Aave v3 on X Layer for real, RWA-backed yield. USDT0<->USDG is swapped on Uniswap v3
///         with a strict slippage bound (never a zero floor), so a thin swap REVERTS rather than
///         losing funds. Only the owning vault may move funds; withdrawals return to the vault.
/// @dev One adapter per (vault, market). The round-trip swap has a small cost the agent must beat
///      with yield before allocating; the deterministic risk engine scores that against Aave. Owner
///      (the vault owner / Safe) can retune slippage and force an emergency exit under a depeg.
contract RwaUsdgAdapter is IVenueAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token; // USDT0 (must equal the vault asset)
    IERC20 public immutable usdg; // USDG (RWA-backed dollar)
    IERC20 public immutable aUsdg; // interest-bearing aUSDG
    IAaveV3Pool public immutable pool; // Aave v3 Pool on X Layer
    ISwapRouter02 public immutable router; // Uniswap v3 SwapRouter02 on X Layer
    address public immutable vault; // the only permitted caller for allocate/deallocate
    uint24 public immutable poolFee; // Uniswap USDT0/USDG fee tier

    // Owner-tunable so a USDG depeg can't permanently strand funds behind a fixed floor.
    // `maxSlippageBps` floors the ACTUAL swap (protects funds on a thin/manipulated pool).
    // `valuationDiscountBps` is the separate, smaller marginal round-trip cost used ONLY to value
    // the position in balanceOf — decoupled so a routine allocate/deallocate doesn't mark NAV
    // up/down by the full swap floor (which would be a front-runnable, agent-controlled step).
    uint256 public maxSlippageBps;
    uint256 public valuationDiscountBps;

    error OnlyVault();
    error BadParam();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(
        address token_,
        address usdg_,
        address aUsdg_,
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
        // Dollar-pegged legs must share decimals for the 1:1 reference (and the bps math) to hold.
        if (IERC20Metadata(usdg_).decimals() != IERC20Metadata(token_).decimals()) revert BadParam();
        token = IERC20(token_);
        usdg = IERC20(usdg_);
        aUsdg = IERC20(aUsdg_);
        pool = IAaveV3Pool(pool_);
        router = ISwapRouter02(router_);
        vault = vault_;
        poolFee = poolFee_;
        maxSlippageBps = maxSlippageBps_;
        valuationDiscountBps = valuationDiscountBps_;
    }

    /// @notice Retune the swap floor (owner / Safe). Widening it is the lever to exit a depegged
    ///         USDG at a controlled haircut instead of reverting forever.
    function setMaxSlippageBps(uint256 bps) external onlyOwner {
        if (bps == 0 || bps >= 10_000 || valuationDiscountBps > bps) revert BadParam();
        maxSlippageBps = bps;
    }

    /// @notice Retune the valuation discount used in balanceOf (owner / Safe). Must not exceed the
    ///         swap floor.
    function setValuationDiscountBps(uint256 bps) external onlyOwner {
        if (bps > maxSlippageBps) revert BadParam();
        valuationDiscountBps = bps;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    /// @dev Swap `amountIn` of `tokenIn` for `tokenOut`, flooring output at (1 - slippage) * amountIn.
    ///      Both legs are dollar-pegged 6dp, so 1:1 is the fair reference; the floor makes a thin or
    ///      manipulated pool revert instead of bleeding value (no zero minOut, ever).
    function _swap(IERC20 tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 out)
    {
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

    function deposit(uint256 amount) external onlyVault returns (uint256 supplied) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 gotUsdg = _swap(token, address(usdg), amount, _floor(amount));
        usdg.forceApprove(address(pool), gotUsdg);
        pool.supply(address(usdg), gotUsdg, address(this), 0);
        usdg.forceApprove(address(pool), 0); // never leave a standing allowance
        // Report what actually reached the venue (after the entry swap cost), not the gross input,
        // so the onchain receipt doesn't overstate the supplied amount.
        return gotUsdg;
    }

    function withdraw(uint256 amount) external onlyVault returns (uint256 withdrawn) {
        // `amount` is in USDT0 terms. USDG ~ USDT0 1:1, so pull that many USDG from Aave (or all on
        // the max sentinel / an over-ask), swap back to USDT0, and return it to the vault.
        uint256 pooled = aUsdg.balanceOf(address(this));
        uint256 pull = (amount == type(uint256).max || amount > pooled) ? pooled : amount;
        if (pull == 0) return 0;
        pool.withdraw(address(usdg), pull, address(this));
        uint256 usdgBal = usdg.balanceOf(address(this));
        uint256 gotUsdt = _swap(usdg, address(token), usdgBal, _floor(usdgBal));
        token.safeTransfer(vault, gotUsdt);
        return gotUsdt;
    }

    /// @notice Owner escape hatch: liquidate the entire USDG position back to USDT0 at a
    ///         caller-supplied floor and return it to the vault. For a depeg where the normal floor
    ///         reverts and the agent can't exit; the owner accepts a controlled haircut. `minOut`
    ///         must be set deliberately (never 0 in practice) — the owner is trusted here.
    function emergencyWithdraw(uint256 minOut) external onlyOwner returns (uint256 got) {
        uint256 pooled = aUsdg.balanceOf(address(this));
        if (pooled == 0) return 0;
        pool.withdraw(address(usdg), pooled, address(this));
        uint256 usdgBal = usdg.balanceOf(address(this));
        got = _swap(usdg, address(token), usdgBal, minOut);
        token.safeTransfer(vault, got);
    }

    /// @notice Realizable value in USDT0 terms: aUSDG held, discounted by `valuationDiscountBps`
    ///         (the realistic marginal round-trip cost, not the full swap floor). Reporting the
    ///         exit-adjusted value keeps share pricing honest, so a depositor who exits first can't
    ///         leave the round-trip cost for later depositors, without marking NAV by a large,
    ///         agent-controlled step on every move.
    function balanceOf(address) external view returns (uint256) {
        uint256 held = aUsdg.balanceOf(address(this)); // USDG ~ USDT0 (both dollar-pegged, 6dp)
        return (held * (10_000 - valuationDiscountBps)) / 10_000;
    }
}
