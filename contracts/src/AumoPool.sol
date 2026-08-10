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

    // --- Churn / loss budget (owner-controlled) ---
    // Caps bound how MUCH can move; this bounds how much VALUE an agent can destroy by churning a
    // lossy venue (each USDT0->USDG->USDT0 round trip burns the AMM spread). A compromised agent
    // can realize at most `maxEpochLoss` of round-trip loss per rolling `lossEpochLength` window,
    // then setAgent() rotation locks it out — value cannot be destroyed without bound. User-driven
    // withdrawals never consult this budget, so exits always work.
    uint256 public maxEpochLoss; // max realized loss the agent may cause per epoch, in asset units
    uint256 public lossEpochLength; // rolling window length, seconds (shared by both budgets)
    uint256 public epochLossStart; // timestamp the current loss window opened
    uint256 public epochLoss; // realized loss charged in the current window

    // Allocate-side rate limit: bounds how much the agent can (re-)deploy per epoch. The redeem
    // exit path is intentionally unmetered so exits never block, which on its own would let a
    // compromised agent who is also a depositor socialize realized swap loss without bound by
    // looping deposit -> allocate -> redeem. Capping deploy throughput caps how fast churn can be
    // re-staged, which bounds that leak. 0 disables (rate limit off).
    uint256 public maxEpochDeploy; // max cumulative allocate per epoch, in asset units (0 = off)
    uint256 public deployEpochLength; // rolling window length for the deploy budget (its OWN window)
    uint256 public epochDeployStart; // timestamp the current deploy window opened
    uint256 public epochDeployed; // amount allocated in the current window

    // Venues marked impaired are EXCLUDED from totalAssets (share price writes down to realizable
    // value) and cannot receive new allocations. Set by owner or agent when a venue can no longer be
    // exited at fair value (e.g. a USDG depeg past the swap floor), so a stuck-but-still-reporting
    // venue can't inflate NAV and let the first redeemers drain healthy liquidity.
    mapping(address => bool) public venueImpaired;

    uint256 private constant DUST = 1e3; // ~0.001 USDT0 (6dp): residual dust tolerated on prune
    uint256 private constant MAX_VENUES = 12; // bound the totalAssets loop (gas / DoS)
    // Over-ask margin when pulling from a venue to cover a withdrawal: comfortably above any sane
    // swap floor so a single pull covers `need` without liquidating the whole (lossy) venue.
    uint256 private constant PULL_MARGIN_BPS = 300; // 3%

    address[] private _venues; // every venue ever allowlisted (for totalAssets summation)
    mapping(address => bool) private _inList;

    // --- Events = onchain receipts ---
    event Allocated(address indexed venue, uint256 amount, bytes32 reason, uint256 timestamp);
    event Deallocated(address indexed venue, uint256 principal, uint256 returned, uint256 timestamp);
    event AgentUpdated(address indexed agent);
    event VenueAllowed(address indexed venue, bool allowed);
    event VenueRemoved(address indexed venue);
    event VenueImpairment(address indexed venue, bool impaired);
    event PolicyUpdated(uint256 maxMoveSize, uint256 perVenueCap, uint256 maxTotalDeployed);
    event LossBudgetUpdated(uint256 maxEpochLoss, uint256 lossEpochLength);
    event DeployBudgetUpdated(uint256 maxEpochDeploy, uint256 deployEpochLength);

    error NotAgent();
    error NotOwnerOrAgent();
    error ZeroAgent();
    error VenueNotAllowed();
    error VenueIsImpaired();
    error ZeroAmount();
    error MoveTooLarge();
    error InsufficientIdle();
    error PerVenueCapExceeded();
    error TotalCapExceeded();
    error AssetMismatch();
    error RenounceDisabled();
    error LossBudgetExceeded();
    error DeployBudgetExceeded();
    error EmptyWithdraw();
    error ZeroEpoch();
    error VenueHasValue();
    error TooManyVenues();
    error NotSelf();

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

        // Fail closed by default: until the owner sets a budget, the agent cannot realize ANY
        // round-trip loss (maxEpochLoss == 0). The deploy script sets a working budget.
        lossEpochLength = 1 days;
        epochLossStart = block.timestamp;
        deployEpochLength = 1 days;
        epochDeployStart = block.timestamp;
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
            // Impaired venues are written down to zero: their reported balance is no longer
            // realizable, so counting it would let first redeemers drain healthy liquidity.
            if (venueImpaired[_venues[i]]) continue;
            // Defense in depth: a venue whose balanceOf reverts contributes 0 rather than bricking
            // share pricing (and thus deposits/exits); the owner then prunes it via forceRemoveVenue.
            try IVenueAdapter(_venues[i]).balanceOf(address(this)) returns (uint256 b) {
                sum += b;
            } catch {}
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
        uint256 n = _venues.length;
        // Sweep venues in repeated passes until idle covers the withdrawal or no venue can yield
        // more. A retreat from a lossy venue nets slightly less than requested (the exit swap
        // cost), so a second pass collects the residual — a full redemption is never left short by
        // rounding/slippage. Bounded by (n + 2) passes; stalls out cleanly if liquidity truly
        // can't cover. User-withdrawal driven, so `enforce` is false and the loss budget never
        // blocks an exit.
        for (uint256 pass; pass < n + 2 && idle < assets; ++pass) {
            uint256 startIdle = idle;
            for (uint256 i; i < n && idle < assets; ++i) {
                address v = _venues[i];
                // Isolate a reverting balanceOf too (not just a reverting withdraw): a single broken
                // view must not brick a redemption another venue can cover.
                uint256 live;
                try IVenueAdapter(v).balanceOf(address(this)) returns (uint256 b) {
                    live = b;
                } catch {
                    continue;
                }
                if (live == 0) continue;
                uint256 need = assets - idle;
                // Size the pull to just cover `need`. First pass: request exactly `need` (a lossless
                // venue delivers it exactly, no waste). Later passes only run if a lossy venue
                // under-delivered, so they over-ask the residual by a fixed margin (> any sane swap
                // floor) to close the gap in one more pull. Only when we genuinely need the venue's
                // whole balance do we drain it with the max sentinel.
                // Critical: NEVER liquidate the full venue for a small/dust redemption — that would
                // force the entire position through the exit swap (and its MEV surface) from a 1-wei
                // action. This keeps a dust redeem pulling only ~dust.
                uint256 pull = need >= live
                    ? type(uint256).max
                    : pass == 0 ? need : (need * (10_000 + PULL_MARGIN_BPS)) / 10_000;
                // Isolate each venue: if its withdraw reverts (a USDG depeg past the swap floor, a
                // paused Aave reserve), skip it and let a healthy venue cover the redemption instead
                // of failing the whole exit. try/catch requires an external call, hence retreatSelf.
                try this.retreatSelf(v, pull) {} catch {}
                idle = idleBalance();
            }
            if (idle == startIdle) break; // no venue could yield more this pass
        }
    }

    /// @dev Self-only external wrapper so `_ensureIdle` can `try/catch` a single-venue retreat.
    ///      Never metered by the loss budget (this is the user-withdrawal path). Not callable by
    ///      anyone but the pool itself.
    function retreatSelf(address venue, uint256 amount) external {
        if (msg.sender != address(this)) revert NotSelf();
        _doDeallocate(venue, amount, false);
    }

    // ------------------------------------------------------------------ owner: policy

    function setAgent(address agent_) external onlyOwner {
        if (agent_ == address(0)) revert ZeroAgent(); // never freeze via zero; use pause instead
        agent = agent_;
        emit AgentUpdated(agent_);
    }

    function setVenueAllowed(address venue, bool allowed) external onlyOwner {
        if (allowed) {
            if (IVenueAdapter(venue).asset() != asset()) revert AssetMismatch();
            if (!_inList[venue]) {
                if (_venues.length >= MAX_VENUES) revert TooManyVenues();
                _inList[venue] = true;
                _venues.push(venue);
            }
        }
        venueAllowed[venue] = allowed;
        emit VenueAllowed(venue, allowed);
    }

    /// @notice Mark a venue impaired (or clear it): impaired venues are excluded from totalAssets so
    ///         the share price writes down to realizable value, and they cannot receive new
    ///         allocations. Settable by the owner or the agent (which monitors venue peg/health), so
    ///         a depegged/stuck venue is written down before first redeemers can drain healthy
    ///         liquidity against inflated NAV. Does not move funds; use deallocate / the adapter's
    ///         emergencyWithdraw to recover value.
    function setVenueImpaired(address venue, bool impaired) external {
        if (msg.sender != owner() && msg.sender != agent) revert NotOwnerOrAgent();
        venueImpaired[venue] = impaired;
        emit VenueImpairment(venue, impaired);
    }

    /// @notice Emergency prune: drop a disallowed venue from the totalAssets summation. Because
    ///         totalAssets() reads every listed venue's live balance, a single retired or broken
    ///         adapter whose balanceOf() reverts would otherwise DoS share pricing (and thus
    ///         deposits and withdrawals) permanently. The venue must be disallowed first; removing
    ///         one that still holds recoverable value strands that value, so retreat first via
    ///         deallocate() whenever the adapter still works. Owner-only, within the existing trust
    ///         model (owner already controls the allowlist and policy).
    function removeVenue(address venue) external onlyOwner {
        if (venueAllowed[venue]) revert VenueNotAllowed(); // disallow before pruning
        // Don't silently strand recoverable value: the venue must be (near-)empty. Retreat via
        // deallocate first. For a genuinely bricked adapter whose balanceOf reverts, use
        // forceRemoveVenue, which acknowledges writing off any residual value.
        if (IVenueAdapter(venue).balanceOf(address(this)) > DUST) revert VenueHasValue();
        _pruneVenue(venue);
    }

    /// @notice Escape hatch for a bricked adapter (its balanceOf reverts, so removeVenue can't even
    ///         read it) to restore totalAssets pricing. Explicitly writes off any value still held
    ///         in the venue. Owner-only, disallow first.
    function forceRemoveVenue(address venue) external onlyOwner {
        if (venueAllowed[venue]) revert VenueNotAllowed();
        _pruneVenue(venue);
    }

    function _pruneVenue(address venue) internal {
        uint256 n = _venues.length;
        for (uint256 i; i < n; ++i) {
            if (_venues[i] == venue) {
                _venues[i] = _venues[n - 1];
                _venues.pop();
                break;
            }
        }
        _inList[venue] = false;
        // Write off any residual principal accounting so totalDeployed stays consistent.
        uint256 principal = allocated[venue];
        if (principal != 0) {
            allocated[venue] = 0;
            totalDeployed -= principal;
        }
        emit VenueRemoved(venue);
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

    /// @notice Set the agent's per-epoch churn-loss budget. `maxEpochLoss_` is the most realized
    ///         round-trip loss the agent may cause within each `lossEpochLength_` window; setting
    ///         it opens a fresh window. Raising it is the escape hatch if a legitimate de-risk needs
    ///         to realize more loss than the current budget allows.
    function setLossBudget(uint256 maxEpochLoss_, uint256 lossEpochLength_) external onlyOwner {
        if (lossEpochLength_ == 0) revert ZeroEpoch();
        maxEpochLoss = maxEpochLoss_;
        lossEpochLength = lossEpochLength_;
        epochLossStart = block.timestamp;
        epochLoss = 0;
        emit LossBudgetUpdated(maxEpochLoss_, lossEpochLength_);
    }

    /// @notice Set the agent's per-epoch deploy budget (allocate-side rate limit) and its OWN window
    ///         length, decoupled from the loss budget so changing one never desyncs the other.
    ///         `maxEpochDeploy_` 0 disables the limit. Setting it opens a fresh window.
    function setDeployBudget(uint256 maxEpochDeploy_, uint256 deployEpochLength_) external onlyOwner {
        if (deployEpochLength_ == 0) revert ZeroEpoch();
        maxEpochDeploy = maxEpochDeploy_;
        deployEpochLength = deployEpochLength_;
        epochDeployStart = block.timestamp;
        epochDeployed = 0;
        emit DeployBudgetUpdated(maxEpochDeploy_, deployEpochLength_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Disabled: a fund-holding pool must never become ownerless. Transfer is two-step
    ///      (Ownable2Step), so ownership cannot be handed to a wrong/dead address by mistake.
    function renounceOwnership() public view override onlyOwner {
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
        if (venueImpaired[venue]) revert VenueIsImpaired();
        if (amount > maxMoveSize) revert MoveTooLarge();
        if (amount > idleBalance()) revert InsufficientIdle();
        if (allocated[venue] + amount > perVenueCap) revert PerVenueCapExceeded();
        if (totalDeployed + amount > maxTotalDeployed) revert TotalCapExceeded();

        // Rate-limit deploy throughput per epoch (its own window). This caps how fast the agent can
        // re-stage churn, bounding realized swap loss even via the unmetered redeem exit path.
        if (maxEpochDeploy != 0) {
            if (block.timestamp >= epochDeployStart + deployEpochLength) {
                epochDeployStart = block.timestamp;
                epochDeployed = 0;
            }
            epochDeployed += amount;
            if (epochDeployed > maxEpochDeploy) revert DeployBudgetExceeded();
        }

        IERC20(asset()).forceApprove(venue, amount);
        uint256 supplied = IVenueAdapter(venue).deposit(amount);
        IERC20(asset()).forceApprove(venue, 0); // never leave a standing allowance to a venue

        // Book the NET value actually placed in the venue (`supplied`), not the gross input. This
        // keeps the principal ledger on the same basis as NAV (the adapter's live balance), so the
        // loss budget doesn't re-charge the entry swap on exit, and caps track real exposure. Caps
        // above were checked against the (larger) gross amount, so they stay conservative. Safe under
        // nonReentrant + an onlyVault adapter that cannot call back.
        allocated[venue] += supplied;
        totalDeployed += supplied;

        emit Allocated(venue, supplied, reason, block.timestamp);
    }

    /// @notice Retreat up to `amount` from a venue back into the pool. Allowed even while paused so
    ///         the agent can always de-risk. Agent-initiated retreats are metered by the loss budget.
    function deallocate(address venue, uint256 amount) external onlyAgent nonReentrant {
        // retreat only from a venue we have ever allowlisted; never a bare call to an arbitrary
        // address. (_ensureIdle only ever targets venues already in the list.)
        if (!_inList[venue]) revert VenueNotAllowed();
        _doDeallocate(venue, amount, true);
    }

    /// @param enforce When true (agent-initiated), any realized round-trip loss is charged to the
    ///        rolling loss budget and reverts once the epoch's budget is spent. When false
    ///        (user-withdrawal driven), the retreat is never blocked, so redemptions always clear.
    function _doDeallocate(address venue, uint256 amount, bool enforce) internal {
        if (amount == 0) revert ZeroAmount();

        uint256 principal = allocated[venue];
        uint256 pulledPrincipal = amount > principal ? principal : amount;

        // Effects before the external interaction (CEI): decrement principal accounting up front.
        // A revert below (including the loss-budget check) rolls this back atomically.
        allocated[venue] = principal - pulledPrincipal;
        totalDeployed -= pulledPrincipal;

        uint256 balBefore = IERC20(asset()).balanceOf(address(this));
        IVenueAdapter(venue).withdraw(amount);
        uint256 returned = IERC20(asset()).balanceOf(address(this)) - balBefore;

        // A venue that reports a balance but returns nothing on withdraw (a silent no-op adapter)
        // would otherwise wipe the principal ledger here (freeing caps) while its value stays
        // trapped. Refuse the phantom retreat: revert, rolling the accounting back. On the user path
        // this is caught by _ensureIdle's try/catch, so a single bad venue is skipped, not fatal.
        if (pulledPrincipal > 0 && returned == 0) revert EmptyWithdraw();

        // Meter agent-driven value destruction. A round trip through the lossy RWA swap returns
        // less than its principal; charge that loss to a rolling per-epoch budget so a compromised
        // agent can churn only until the budget is spent, not until the treasury is empty.
        if (enforce && returned < pulledPrincipal) {
            uint256 loss = pulledPrincipal - returned;
            if (block.timestamp >= epochLossStart + lossEpochLength) {
                epochLossStart = block.timestamp;
                epochLoss = 0;
            }
            epochLoss += loss;
            if (epochLoss > maxEpochLoss) revert LossBudgetExceeded();
        }

        emit Deallocated(venue, pulledPrincipal, returned, block.timestamp);
    }
}
