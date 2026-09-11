// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev A Uniswap-v3-shaped SwapRouter02 stand-in for tests. Fills path-based `exactInput` at a
///      settable pool price (USD/share, WAD) between a USD₮0-like token and a stock-like token,
///      enforcing amountOutMinimum exactly like the real router ("Too little received"). It reads the
///      first and last token from the v3 path and prices the swap direct between them, ignoring any
///      intermediate hop (so a USD₮0 -> USDG -> stock path prices the same as a direct pool) — enough
///      to exercise the adapter's routing and guards. Set the pool price away from the oracle to
///      simulate a deviating pool. Must be pre-funded with both tokens so it can pay out.
contract MockSwapRouter {
    address public immutable usdt0;
    address public immutable stock;
    uint8 public immutable tokenDec;
    uint8 public immutable stockDec;
    uint256 public poolPriceWad; // USD per share, WAD
    uint256 private constant WAD = 1e18;

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
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

    function exactInput(ExactInputParams calldata p) external returns (uint256 amountOut) {
        address tokenIn = _firstToken(p.path);
        address tokenOut = _lastToken(p.path);
        IERC20(tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        if (tokenIn == usdt0 && tokenOut == stock) {
            uint256 usdWad = (p.amountIn * WAD) / (10 ** tokenDec);
            amountOut = (usdWad * (10 ** stockDec)) / poolPriceWad;
        } else if (tokenIn == stock && tokenOut == usdt0) {
            uint256 usdWad = (p.amountIn * poolPriceWad) / (10 ** stockDec);
            amountOut = (usdWad * (10 ** tokenDec)) / WAD;
        } else {
            revert("bad path");
        }
        require(amountOut >= p.amountOutMinimum, "Too little received");
        IERC20(tokenOut).transfer(p.recipient, amountOut);
    }

    function _firstToken(bytes calldata path) private pure returns (address a) {
        a = address(bytes20(path[0:20]));
    }

    function _lastToken(bytes calldata path) private pure returns (address a) {
        a = address(bytes20(path[path.length - 20:path.length]));
    }
}
