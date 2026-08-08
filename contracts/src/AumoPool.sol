// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVenueAdapter} from "./interfaces/IVenueAdapter.sol";

/// @title AumoPool
/// @notice The multi-depositor version of Aumo. Anyone deposits USDT0 and receives pool shares
///         (ERC-4626); an allowlisted agent puts the pooled balance to work in yield venues, but
///         only within hard, owner-set guardrails — identical trust model to AumoVault. Share
///         value tracks idle balance plus the live value held in venues, so yield accrues to every
///         depositor pro-rata. Depositors redeem on demand; withdrawals pull from venues,
///         subject to each venue's available liquidity.
/// @dev The agent can never exceed a cap, touch a non-allowlisted venue, act while paused, or move
///      user funds anywhere except into allowlisted venues and back. It cannot mint, burn, or
///      redeem shares, and it cannot send funds to itself. Owner controls policy, not custody.
contract AumoPool is ERC4626, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The autonomous allocator permitted to move pooled funds within policy.
    address public agent;

    // --- Guardrails (owner-controlled) ---
    mapping(address => bool) public venueAllowed;
    uint256 public maxMoveSize;
    uint256 public perVenueCap;
    uint256 public maxTotalDeployed;

    // --- Accounting (principal basis) ---
    mapping(address => uint256) public allocated; // venue => principal deployed
    uint256 public totalDeployed;

    address[] private _venues; // every venue ever allowlisted (for totalAssets summation)
    mapping(address => bool) private _inList;

    // --- Events = onchain receipts ---
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

    constructor(IERC20 asset_, address owner_)
        ERC20("Aumo USDT0 Pool", "aumoUSDT0")
        ERC4626(asset_)
        Ownable(owner_)
    {
        agent = owner_;
        emit AgentUpdated(owner_);
    }

    // ------------------------------------------------------------------ accounting

    /// @notice Total assets the pool controls: idle balance plus the live value held in every
    ///         venue (principal + accrued yield, per each adapter), regardless of the principal
    ///         counter.
    function totalAssets() public view override returns (uint256) {
        uint256 sum = IERC20(asset()).balanceOf(address(this));
        uint256 n = _venues.length;
        for (uint256 i; i < n; ++i) {
            // Sum each venue's LIVE balance, not its principal counter. A venue can still hold
            // accrued yield after its principal is fully deallocated; that value must keep
            // counting toward the share price. Untouched venues report zero.
            sum += IVenueAdapter(_venues[i]).balanceOf(address(this));
        }
        return sum;
    }

    /// @notice Idle asset in the pool, not deployed to any venue.
    function idleBalance() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @notice Live value the pool holds in a venue (principal + accrued), per the adapter.
    ///         Mirrors AumoVault so the same off-chain agent can manage either contract.
    function venueBalance(address venue) external view returns (uint256) {
        return IVenueAdapter(venue).balanceOf(address(this));
    }

    /// @dev Virtual-share offset for the ERC-4626 first-depositor inflation attack. At 6, the
    ///      pool holds ~1e6 virtual shares against a virtual asset, so a donation attack cannot
    ///      profit and a victim's rounding loss is negligible.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ------------------------------------------------------------------ user flows

    // Deposits are paused by the kill switch; redemptions never are, so depositors can always exit.

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner);
    }

    /// @dev Before paying out a withdrawal, top up the idle balance by retreating from venues.
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        _ensureIdle(assets);
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _ensureIdle(uint256 assets) internal {
        uint256 idle = idleBalance();
        if (idle >= assets) return;
        uint256 need = assets - idle;
        uint256 n = _venues.length;
        for (uint256 i; i < n && need > 0; ++i) {
            address v = _venues[i];
            uint256 live = IVenueAdapter(v).balanceOf(address(this));
            if (live == 0) continue;
            uint256 pull = need > live ? live : need;
            _doDeallocate(v, pull);
            uint256 nowIdle = idleBalance();
            need = assets > nowIdle ? assets - nowIdle : 0;
        }
    }

    // ------------------------------------------------------------------ owner: policy

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentUpdated(agent_);
    }

    function setVenueAllowed(address venue, bool allowed) external onlyOwner {
        if (allowed) {
            if (IVenueAdapter(venue).asset() != asset()) revert AssetMismatch();
            if (!_inList[venue]) {
                _inList[venue] = true;
                _venues.push(venue);
            }
        }
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Disabled: a fund-holding pool must never become ownerless. Transfer is two-step
    ///      (Ownable2Step), so ownership cannot be handed to a wrong/dead address by mistake.
    function renounceOwnership() public override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------ agent: allocation

    /// @notice Deploy idle asset into an allowlisted venue, within every guardrail.
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

        IERC20(asset()).forceApprove(venue, amount);
        uint256 supplied = IVenueAdapter(venue).deposit(amount);
        IERC20(asset()).forceApprove(venue, 0); // never leave a standing allowance to a venue

        emit Allocated(venue, supplied, reason, block.timestamp);
    }

    /// @notice Retreat up to `amount` from a venue back into the pool. Allowed even while paused.
    function deallocate(address venue, uint256 amount) external onlyAgent nonReentrant {
        // retreat only from a venue we have ever allowlisted; never a bare call to an arbitrary
        // address. (_ensureIdle only ever targets venues already in the list.)
        if (!_inList[venue]) revert VenueNotAllowed();
        _doDeallocate(venue, amount);
    }

    function _doDeallocate(address venue, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();

        uint256 principal = allocated[venue];
        uint256 pulledPrincipal = amount > principal ? principal : amount;

        uint256 balBefore = IERC20(asset()).balanceOf(address(this));
        IVenueAdapter(venue).withdraw(amount);
        uint256 returned = IERC20(asset()).balanceOf(address(this)) - balBefore;

        allocated[venue] = principal - pulledPrincipal;
        totalDeployed -= pulledPrincipal;

        emit Deallocated(venue, pulledPrincipal, returned, block.timestamp);
    }
}
