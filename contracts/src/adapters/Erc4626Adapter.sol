// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";

/// @dev Minimal slice of an ERC-4626 tokenized vault used by this adapter.
interface IERC4626Vault {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function maxWithdraw(address owner) external view returns (uint256 maxAssets);
    function balanceOf(address account) external view returns (uint256);
}

/// @title Erc4626Adapter
/// @notice Venue adapter for any ERC-4626 savings vault whose `asset()` equals the Aumo base asset
///         (USD₮0). It supplies the vault's USD₮0 into the ERC-4626 vault, holds the shares, and
///         reports the live position as the current asset value of those shares (principal plus
///         accrued savings yield). First use: Spark Savings USDT (spUSDT) on X Layer, a Sky/Spark
///         savings vault denominated in USD₮0 with flexible redemption — so there is no swap leg,
///         unlike the USDG venues. Only the owning vault may move funds; withdrawals go straight
///         back to the vault. One adapter instance per (vault, ERC-4626 venue).
contract Erc4626Adapter is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token; // base asset (USD₮0)
    IERC4626Vault public immutable venue; // the ERC-4626 savings vault (e.g. spUSDT)
    address public immutable vault; // the only permitted caller

    error OnlyVault();
    error AssetMismatch();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    /// @param token_ the base asset (must equal the owning vault's asset)
    /// @param venue_ the ERC-4626 savings vault; its `asset()` must equal `token_`
    /// @param vault_ the owning AumoPool/AumoVault, the only permitted caller
    constructor(address token_, address venue_, address vault_) {
        // The ERC-4626 vault must be denominated in exactly the base asset, or deposits and
        // withdrawals would silently move the wrong token. Enforced at construction, never assumed.
        if (IERC4626Vault(venue_).asset() != token_) revert AssetMismatch();
        token = IERC20(token_);
        venue = IERC4626Vault(venue_);
        vault = vault_;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 amount) external onlyVault returns (uint256 supplied) {
        if (amount == 0) return 0;
        token.safeTransferFrom(msg.sender, address(this), amount);
        token.forceApprove(address(venue), amount);
        venue.deposit(amount, address(this)); // shares minted to this adapter
        token.forceApprove(address(venue), 0); // never leave a standing allowance
        return amount;
    }

    function withdraw(uint256 amount) external onlyVault returns (uint256 withdrawn) {
        // Never request more than the position can return this block (share rounding / vault cap).
        uint256 max = venue.maxWithdraw(address(this));
        uint256 assets = amount > max ? max : amount;
        if (assets == 0) return 0;
        // ERC-4626 sends the underlying straight to `receiver` (the vault) and burns shares from
        // `owner` (this adapter). msg.sender == owner here, so no share allowance is needed.
        venue.withdraw(assets, msg.sender, address(this));
        return assets;
    }

    function balanceOf(address) external view returns (uint256) {
        // Live asset value of the shares held, including accrued savings yield.
        return venue.convertToAssets(venue.balanceOf(address(this)));
    }
}
