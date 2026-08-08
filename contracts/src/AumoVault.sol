// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVenueAdapter} from "./interfaces/IVenueAdapter.sol";

/// @title AumoVault
/// @notice Guardrail-first treasury vault for Aumo. The owner funds it with the base asset
///         (USDT0). A designated `agent` may allocate that balance into allowlisted yield
///         venues, but ONLY within hard, owner-set policy limits. Every action emits an
///         onchain receipt. This is the trust core: it is built and tested before the agent
///         ever moves a cent, and the agent physically cannot exceed its guardrails.
/// @dev The agent can never: touch a non-allowlisted venue, move more than `maxMoveSize` in
///      one call, exceed `perVenueCap` in any venue, exceed `maxTotalDeployed` overall, act
///      while paused, or withdraw funds to itself (only the owner can withdraw idle funds).
contract AumoVault is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The base asset the vault holds and deploys (USDT0).
    IERC20 public immutable asset;

    /// @notice The autonomous allocator permitted to move funds within policy.
    address public agent;

    // --- Guardrails (owner-controlled) ---
    mapping(address => bool) public venueAllowed; // adapter => allowed
    uint256 public maxMoveSize; // max asset moved in a single allocate()
    uint256 public perVenueCap; // max principal held in any one venue
    uint256 public maxTotalDeployed; // max principal deployed across all venues

    // --- Accounting (principal basis) ---
    mapping(address => uint256) public allocated; // venue => principal deployed
    uint256 public totalDeployed;

    // --- Events = onchain receipts ---
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Allocated(address indexed venue, uint256 amount, bytes32 reason, uint256 timestamp);
    event Deallocated(address indexed venue, uint256 principal, uint256 returned, uint256 timestamp);
    event AgentUpdated(address indexed agent);
    event VenueAllowed(address indexed venue, bool allowed);
    event PolicyUpdated(uint256 maxMoveSize, uint256 perVenueCap, uint256 maxTotalDeployed);

    error NotAgent();
    error VenueNotAllowed();
    error ZeroAmount();
    error MoveTooLarge();
    error InsufficientIdle();
    error PerVenueCapExceeded();
    error TotalCapExceeded();
    error AssetMismatch();
    error RenounceDisabled();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address asset_, address owner_) Ownable(owner_) {
        asset = IERC20(asset_);
        agent = owner_; // owner acts as agent until a dedicated agent is set
        emit AgentUpdated(owner_);
    }

    // ------------------------------------------------------------------ owner: funding

    function deposit(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw idle (undeployed) asset back to the owner. Never touches deployed funds.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > idleBalance()) revert InsufficientIdle();
        asset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ owner: policy

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentUpdated(agent_);
    }

    function setVenueAllowed(address venue, bool allowed) external onlyOwner {
        if (allowed && IVenueAdapter(venue).asset() != address(asset)) revert AssetMismatch();
        venueAllowed[venue] = allowed;
        emit VenueAllowed(venue, allowed);
    }

    function setPolicy(uint256 maxMoveSize_, uint256 perVenueCap_, uint256 maxTotalDeployed_)
        external
        onlyOwner
    {
        maxMoveSize = maxMoveSize_;
        perVenueCap = perVenueCap_;
        maxTotalDeployed = maxTotalDeployed_;
        emit PolicyUpdated(maxMoveSize_, perVenueCap_, maxTotalDeployed_);
    }

    /// @notice Kill switch. While paused, the agent cannot allocate; retreat is always allowed.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Disabled: a fund-holding vault must never become ownerless. Transfer is two-step
    ///      (Ownable2Step), so ownership cannot be handed to a wrong/dead address by mistake.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------ agent: allocation

    /// @notice Deploy `amount` of idle asset into an allowlisted `venue`, within all guardrails.
    /// @param reason Free-form tag (e.g. "aave-supply", "stbl-yield") recorded in the receipt.
    function allocate(address venue, uint256 amount, bytes32 reason)
        external
        onlyAgent
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (!venueAllowed[venue]) revert VenueNotAllowed();
        if (amount > maxMoveSize) revert MoveTooLarge();
        if (amount > idleBalance()) revert InsufficientIdle();
        if (allocated[venue] + amount > perVenueCap) revert PerVenueCapExceeded();
        if (totalDeployed + amount > maxTotalDeployed) revert TotalCapExceeded();

        allocated[venue] += amount;
        totalDeployed += amount;

        asset.forceApprove(venue, amount);
        uint256 supplied = IVenueAdapter(venue).deposit(amount);
        asset.forceApprove(venue, 0); // never leave a standing allowance to a venue

        emit Allocated(venue, supplied, reason, block.timestamp);
    }

    /// @notice Pull up to `amount` of asset back from a venue into the vault. Not gated by pause
    ///         (the vault must always be able to retreat), still agent-only. Any yield beyond
    ///         principal lands as idle balance in the vault.
    function deallocate(address venue, uint256 amount) external onlyAgent nonReentrant {
        if (amount == 0) revert ZeroAmount();
        // retreat is allowed from any venue we still hold, or any currently-allowlisted one;
        // never a bare call to an arbitrary address.
        if (!venueAllowed[venue] && allocated[venue] == 0) revert VenueNotAllowed();

        uint256 principal = allocated[venue];
        uint256 pulledPrincipal = amount > principal ? principal : amount;

        uint256 balBefore = asset.balanceOf(address(this));
        IVenueAdapter(venue).withdraw(amount);
        uint256 returned = asset.balanceOf(address(this)) - balBefore;

        allocated[venue] = principal - pulledPrincipal;
        totalDeployed -= pulledPrincipal;

        emit Deallocated(venue, pulledPrincipal, returned, block.timestamp);
    }

    // ------------------------------------------------------------------ views

    /// @notice Asset sitting in the vault, not deployed to any venue.
    function idleBalance() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Live value the vault holds in a venue (principal + accrued yield), per the adapter.
    function venueBalance(address venue) external view returns (uint256) {
        return IVenueAdapter(venue).balanceOf(address(this));
    }
}
