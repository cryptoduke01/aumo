// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IVenueAdapter
/// @notice Uniform interface Aumo uses to move the base asset (USDT0) into and out of a
///         single yield venue on X Layer (e.g. an Aave supply wrapper, an STBL RWA-yield
///         wrapper). One adapter per venue; the vault only ever talks to adapters, never to
///         a protocol directly, so the vault's guardrails apply uniformly.
interface IVenueAdapter {
    /// @notice The base asset this adapter accepts. Must equal the vault's asset.
    function asset() external view returns (address);

    /// @notice Pull `amount` of `asset` from the caller (the vault) and supply it to the venue.
    /// @dev The vault approves `amount` to this adapter immediately before calling.
    /// @return supplied The amount actually supplied to the venue.
    function deposit(uint256 amount) external returns (uint256 supplied);

    /// @notice Redeem up to `amount` of `asset` from the venue and return it to the caller.
    /// @return withdrawn The amount actually returned to the vault (may include realized yield).
    function withdraw(uint256 amount) external returns (uint256 withdrawn);

    /// @notice Current value, in `asset` terms, that `account` holds in this venue.
    function balanceOf(address account) external view returns (uint256);
}
