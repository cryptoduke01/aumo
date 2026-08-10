// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
///         Value is reported through the aUSDG balance (USDG and USDT0 are both dollar-pegged, 6dp).
/// @dev One adapter per (vault, market). The round-trip swap has a small cost the agent must beat
///      with yield before allocating; the deterministic risk engine scores that against Aave.
contract RwaUsdgAdapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token; // USDT0 (must equal the vault asset)
    IERC20 public immutable usdg; // USDG (RWA-backed dollar)
    IERC20 public immutable aUsdg; // interest-bearing aUSDG
    IAaveV3Pool public immutable pool; // Aave v3 Pool on X Layer
    ISwapRouter02 public immutable router; // Uniswap v3 SwapRouter02 on X Layer
    address public immutable vault; // the only permitted caller
    uint24 public immutable poolFee; // Uniswap USDT0/USDG fee tier
    uint256 public immutable maxSlippageBps; // e.g. 100 = 1%

    error OnlyVault();

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
        uint24 poolFee_,
        uint256 maxSlippageBps_
    ) {
        token = IERC20(token_);
        usdg = IERC20(usdg_);
        aUsdg = IERC20(aUsdg_);
        pool = IAaveV3Pool(pool_);
        router = ISwapRouter02(router_);
        vault = vault_;
        poolFee = poolFee_;
        maxSlippageBps = maxSlippageBps_;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    /// @dev Swap `amountIn` of `tokenIn` for `tokenOut`, flooring output at (1 - slippage) * amountIn.
    ///      Both legs are dollar-pegged 6dp, so 1:1 is the fair reference; the floor makes a thin or
    ///      manipulated pool revert instead of bleeding value (no zero minOut, ever).
    function _swap(IERC20 tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256 out) {
        tokenIn.forceApprove(address(router), amountIn);
        uint256 minOut = (amountIn * (10_000 - maxSlippageBps)) / 10_000;
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

    function deposit(uint256 amount) external onlyVault returns (uint256 supplied) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 gotUsdg = _swap(token, address(usdg), amount);
        usdg.forceApprove(address(pool), gotUsdg);
        pool.supply(address(usdg), gotUsdg, address(this), 0);
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
        uint256 gotUsdt = _swap(usdg, address(token), usdg.balanceOf(address(this)));
        token.safeTransfer(vault, gotUsdt);
        return gotUsdt;
    }

    /// @notice Realizable value in USDT0 terms: the aUSDG held, discounted by the worst-case exit
    ///         swap cost (`maxSlippageBps`). Reporting the exit-adjusted value — not the gross 1:1
    ///         aUSDG — keeps share pricing honest, so a depositor who exits first cannot leave the
    ///         round-trip cost for later depositors, and full redemption is never blocked by an
    ///         overstated balance. The discount is conservative: the actual exit usually beats the
    ///         floor, and that surplus accrues to remaining depositors.
    function balanceOf(address) external view returns (uint256) {
        uint256 held = aUsdg.balanceOf(address(this)); // USDG ~ USDT0 (both dollar-pegged, 6dp)
        return (held * (10_000 - maxSlippageBps)) / 10_000;
    }
}
