// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";

/// @dev Minimal slice of the Aave v3 Pool used by this adapter.
interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// @title AaveV3Adapter
/// @notice Venue adapter that supplies the vault's USDT0 into Aave v3 on X Layer and reports the
///         live position through the aToken balance (aTokens are 1:1 with the underlying and
///         accrue interest). Only the owning vault may move funds; withdrawals go straight back
///         to the vault. One adapter instance per (vault, market).
contract AaveV3Adapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token; // USDT0
    IAaveV3Pool public immutable pool; // Aave v3 Pool on X Layer
    IERC20 public immutable aToken; // interest-bearing aUSDT0
    address public immutable vault; // the only permitted caller

    error OnlyVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address token_, address pool_, address aToken_, address vault_) {
        token = IERC20(token_);
        pool = IAaveV3Pool(pool_);
        aToken = IERC20(aToken_);
        vault = vault_;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 amount) external onlyVault returns (uint256 supplied) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        token.forceApprove(address(pool), amount);
        pool.supply(address(token), amount, address(this), 0);
        token.forceApprove(address(pool), 0); // never leave a standing allowance
        return amount;
    }

    function withdraw(uint256 amount) external onlyVault returns (uint256 withdrawn) {
        // Aave sends the underlying straight to `to` (the vault).
        return pool.withdraw(address(token), amount, msg.sender);
    }

    function balanceOf(address) external view returns (uint256) {
        return aToken.balanceOf(address(this));
    }
}
