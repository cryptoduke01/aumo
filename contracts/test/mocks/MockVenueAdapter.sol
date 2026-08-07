// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../../src/interfaces/IVenueAdapter.sol";

/// @dev Stand-in yield venue for tests. Holds the asset per depositor and can simulate yield
///      via accrue(). Real adapters wrap Aave supply / STBL RWA-yield on X Layer.
contract MockVenueAdapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    mapping(address => uint256) public position; // account => asset value held

    constructor(address token_) {
        token = IERC20(token_);
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 amount) external returns (uint256) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        position[msg.sender] += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 bal = position[msg.sender];
        uint256 amt = amount > bal ? bal : amount;
        position[msg.sender] = bal - amt;
        token.safeTransfer(msg.sender, amt);
        return amt;
    }

    function balanceOf(address account) external view returns (uint256) {
        return position[account];
    }

    /// @dev Test helper: simulate yield accruing to `account`. Caller must fund this contract
    ///      with `yield` tokens first so withdraw() can pay it out.
    function accrue(address account, uint256 yield) external {
        position[account] += yield;
    }
}
