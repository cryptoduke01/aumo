// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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

interface IAumoPool {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
}

/// @title ZapDeposit
/// @notice One-transaction deposit for any stablecoin that has a Uniswap v3 route to the pool's asset
///         (USDT0). Pulls `tokenIn` from the caller, swaps it to USDT0 behind a caller-set minimum,
///         and deposits the proceeds into the AumoPool with shares minted straight to the caller. On
///         X Layer this unlocks USDG — the chain's dominant stablecoin — as a one-click deposit, so a
///         USDG holder no longer has to pre-swap to USDT0 before depositing.
/// @dev Stateless and custody-free: it holds no funds between calls, leaves no standing approvals, and
///      can only ever move the caller's OWN tokens into shares owned by an address the caller names.
///      The `minUsdt0Out` floor (never 0 in a real call) bounds swap slippage and sandwich. If
///      `tokenIn` is already USDT0 it deposits directly with no swap. Not upgradeable, no owner, no
///      privileged functions — nothing to seize.
contract ZapDeposit {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt0; // the pool's asset
    IAumoPool public immutable pool;
    ISwapRouter02 public immutable router;

    error BadParam();
    error ZeroShares();

    event Zapped(
        address indexed caller,
        address indexed receiver,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 usdt0In,
        uint256 shares
    );

    constructor(address pool_, address router_) {
        address asset = IAumoPool(pool_).asset();
        if (asset == address(0) || router_ == address(0)) revert BadParam();
        usdt0 = IERC20(asset);
        pool = IAumoPool(pool_);
        router = ISwapRouter02(router_);
    }

    /// @notice Swap `amountIn` of `tokenIn` to USDT0 (>= `minUsdt0Out`) and deposit into the pool.
    /// @param tokenIn      the stablecoin the caller holds (e.g. USDG); if USDT0, no swap is done
    /// @param fee          the Uniswap v3 fee tier of the tokenIn/USDT0 pool (ignored when no swap)
    /// @param amountIn     amount of tokenIn to pull from the caller
    /// @param minUsdt0Out  hard floor on the USDT0 supplied to the pool (bounds swap slippage)
    /// @param receiver     who receives the pool shares (address(0) = the caller)
    /// @return shares      pool shares minted to `receiver`
    function zapDeposit(address tokenIn, uint24 fee, uint256 amountIn, uint256 minUsdt0Out, address receiver)
        external
        returns (uint256 shares)
    {
        if (amountIn == 0 || minUsdt0Out == 0) revert BadParam();
        address to = receiver == address(0) ? msg.sender : receiver;

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 usdt0In;
        if (tokenIn == address(usdt0)) {
            usdt0In = amountIn; // already the pool asset — deposit straight through
            if (usdt0In < minUsdt0Out) revert BadParam();
        } else {
            IERC20(tokenIn).forceApprove(address(router), amountIn);
            usdt0In = router.exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: address(usdt0),
                    fee: fee,
                    recipient: address(this),
                    amountIn: amountIn,
                    amountOutMinimum: minUsdt0Out,
                    sqrtPriceLimitX96: 0
                })
            );
            IERC20(tokenIn).forceApprove(address(router), 0); // never leave a standing allowance
        }

        usdt0.forceApprove(address(pool), usdt0In);
        shares = pool.deposit(usdt0In, to);
        usdt0.forceApprove(address(pool), 0);
        if (shares == 0) revert ZeroShares();

        emit Zapped(msg.sender, to, tokenIn, amountIn, usdt0In, shares);
    }
}
