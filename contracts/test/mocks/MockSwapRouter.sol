// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev A Uniswap-v3-shaped SwapRouter02 stand-in for tests. Fills exactInputSingle at a settable
///      pool price (USD/share, WAD) between a USD₮0-like token and a stock-like token, enforcing
///      amountOutMinimum exactly like the real router ("Too little received"). Set the pool price
///      away from the oracle to simulate a manipulated/deviating pool. Must be pre-funded with both
///      tokens so it can pay out.
contract MockSwapRouter {
    address public immutable usdt0;
    address public immutable stock;
    uint8 public immutable tokenDec;
    uint8 public immutable stockDec;
    uint256 public poolPriceWad; // USD per share, WAD
    uint256 private constant WAD = 1e18;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    constructor(address usdt0_, address stock_, uint8 tokenDec_, uint8 stockDec_, uint256 poolPriceWad_) {
        usdt0 = usdt0_;
        stock = stock_;
        tokenDec = tokenDec_;
        stockDec = stockDec_;
        poolPriceWad = poolPriceWad_;
    }

    function setPrice(uint256 poolPriceWad_) external {
        poolPriceWad = poolPriceWad_;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external returns (uint256 amountOut) {
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        if (p.tokenIn == usdt0 && p.tokenOut == stock) {
            uint256 usdWad = (p.amountIn * WAD) / (10 ** tokenDec);
            amountOut = (usdWad * (10 ** stockDec)) / poolPriceWad;
        } else if (p.tokenIn == stock && p.tokenOut == usdt0) {
            uint256 usdWad = (p.amountIn * poolPriceWad) / (10 ** stockDec);
            amountOut = (usdWad * (10 ** tokenDec)) / WAD;
        } else {
            revert("bad pair");
        }
        require(amountOut >= p.amountOutMinimum, "Too little received");
        IERC20(p.tokenOut).transfer(p.recipient, amountOut);
    }
}
