// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IVenueAdapter} from "../interfaces/IVenueAdapter.sol";

/* -------------------------------------------------------------------------- */
/*  Pendle V4 router types — vendored so the ABI tuples (and therefore the     */
/*  function selectors) match the live router exactly. Enum-typed fields are   */
/*  declared as uint8, which is their canonical ABI encoding.                  */
/* -------------------------------------------------------------------------- */
struct SwapData {
    uint8 swapType;
    address extRouter;
    bytes extCalldata;
    bool needScale;
}

struct ApproxParams {
    uint256 guessMin;
    uint256 guessMax;
    uint256 guessOffchain;
    uint256 maxIteration;
    uint256 eps;
}

struct TokenInput {
    address tokenIn;
    uint256 netTokenIn;
    address tokenMintSy;
    address pendleSwap;
    SwapData swapData;
}

struct TokenOutput {
    address tokenOut;
    uint256 minTokenOut;
    address tokenRedeemSy;
    address pendleSwap;
    SwapData swapData;
}

struct Order {
    uint256 salt;
    uint256 expiry;
    uint256 nonce;
    uint8 orderType;
    address token;
    address YT;
    address maker;
    address receiver;
    uint256 makingAmount;
    uint256 lnImpliedRate;
    uint256 failSafeRate;
    bytes permit;
}

struct FillOrderParams {
    Order order;
    bytes signature;
    uint256 makingAmount;
}

struct LimitOrderData {
    address limitRouter;
    uint256 epsSkipMarket;
    FillOrderParams[] normalFills;
    FillOrderParams[] flashFills;
    bytes optData;
}

interface IPendleRouter {
    function swapExactTokenForPt(
        address receiver,
        address market,
        uint256 minPtOut,
        ApproxParams calldata guessPtOut,
        TokenInput calldata input,
        LimitOrderData calldata limit
    ) external payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm);

    function swapExactPtForToken(
        address receiver,
        address market,
        uint256 exactPtIn,
        TokenOutput calldata output,
        LimitOrderData calldata limit
    ) external returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm);

    function redeemPyToToken(address receiver, address YT, uint256 netPyIn, TokenOutput calldata output)
        external
        returns (uint256 netTokenOut, uint256 netSyInterm);
}

interface IPtOracle {
    /// @dev PT price in asset (SY-underlying) terms, 1e18-scaled. Trends to 1e18 at/after expiry.
    function getPtToAssetRate(address market, uint32 duration) external view returns (uint256);
}

interface IPendleMarket {
    function isExpired() external view returns (bool);
    function readTokens() external view returns (address SY, address PT, address YT);
}

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

/// @title PendlePtAdapter
/// @notice Routes the vault's USDT0 into a Pendle Principal Token (PT) to lock in FIXED yield on a
///         tokenized real-world-asset dollar. PT redeems 1:1 for USDG at maturity and trades at a
///         discount before it, so buying PT below par IS the fixed yield. The path is
///         USDT0 -> USDG (Uniswap v3, slippage-floored) -> PT (Pendle, slippage-floored); the exit is
///         PT -> USDG (market sell before maturity, or 1:1 redeem after) -> USDT0. The position is
///         valued in balanceOf() by Pendle's TWAP PT oracle (never a spot read), so share pricing is
///         not single-block manipulable. Only the owning vault may move funds; the owner can retune
///         slippage/valuation and force an emergency exit under stress.
/// @dev One adapter per (vault, Pendle market). Every swap carries a non-zero floor, so a thin or
///      manipulated pool REVERTS rather than bleeding value. The maturity round-trip cost is a real
///      drag the agent's risk engine must beat with the fixed yield before allocating.
contract PendlePtAdapter is IVenueAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token; // USDT0 (must equal the vault asset)
    IERC20 public immutable usdg; // USDG — the SY's underlying; the Pendle leg is denominated here
    IERC20 public immutable pt; // Pendle Principal Token
    address public immutable yt; // Pendle Yield Token (needed for the post-maturity redeem path)
    address public immutable market; // Pendle market (PT/SY AMM)
    IPendleRouter public immutable router; // Pendle Router V4
    IPtOracle public immutable ptOracle; // Pendle PT TWAP oracle
    ISwapRouter02 public immutable uniRouter; // Uniswap v3 SwapRouter02 (USDT0<->USDG)
    address public immutable vault; // the only permitted caller for allocate/deallocate
    uint24 public immutable uniPoolFee; // USDT0/USDG Uniswap fee tier

    // Owner-tunable so a depeg or a thin market can't permanently strand funds behind a fixed floor.
    uint256 public uniSlippageBps; // floor on each USDT0<->USDG Uniswap leg
    uint256 public pendleSlippageBps; // floor on each USDG<->PT Pendle leg
    uint256 public valuationDiscountBps; // NAV haircut in balanceOf (marginal round-trip cost)
    uint32 public twapDuration; // PT oracle TWAP window (seconds)
    // Last clamped PT->asset rate from a successful oracle read on the money path. balanceOf falls
    // back to it if the live oracle reverts, so a Pendle oracle hiccup can never brick the pool's
    // pool-wide totalAssets. It is a real, recent, par-clamped TWAP value, not attacker-set.
    uint256 public lastGoodRate;
    // When lastGoodRate was set (on the money path). balanceOf trusts the fallback only while it is
    // fresher than `maxRateStaleness`; past that, a persistently dead oracle stops feeding a stale
    // NAV that could be arbitraged, and the venue simply drops out of NAV until the oracle recovers.
    uint256 public lastGoodRateAt;
    uint256 public maxRateStaleness; // max age of the balanceOf fallback before the venue reads 0 (G-3)

    event SlippageUpdated(uint256 uniBps, uint256 pendleBps);
    event ValuationDiscountUpdated(uint256 bps);
    event TwapDurationUpdated(uint32 seconds_);
    event MaxRateStalenessUpdated(uint256 seconds_);

    error OnlyVault();
    error BadParam();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(
        address token_,
        address usdg_,
        address market_,
        address router_,
        address ptOracle_,
        address uniRouter_,
        address vault_,
        address owner_,
        uint24 uniPoolFee_,
        uint256 uniSlippageBps_,
        uint256 pendleSlippageBps_,
        uint256 valuationDiscountBps_,
        uint32 twapDuration_
    ) Ownable(owner_) {
        if (uniSlippageBps_ == 0 || uniSlippageBps_ >= 10_000) revert BadParam();
        if (pendleSlippageBps_ == 0 || pendleSlippageBps_ >= 10_000) revert BadParam();
        if (valuationDiscountBps_ > pendleSlippageBps_ + uniSlippageBps_) revert BadParam();
        if (twapDuration_ == 0) revert BadParam();
        (, address pt_, address yt_) = IPendleMarket(market_).readTokens();
        // Dollar-pegged, equal-decimal legs keep the 1:1 reference and the bps/rate math honest.
        uint8 d = IERC20Metadata(token_).decimals();
        if (IERC20Metadata(usdg_).decimals() != d || IERC20Metadata(pt_).decimals() != d) revert BadParam();

        token = IERC20(token_);
        usdg = IERC20(usdg_);
        pt = IERC20(pt_);
        yt = yt_;
        market = market_;
        router = IPendleRouter(router_);
        ptOracle = IPtOracle(ptOracle_);
        uniRouter = ISwapRouter02(uniRouter_);
        vault = vault_;
        uniPoolFee = uniPoolFee_;
        uniSlippageBps = uniSlippageBps_;
        pendleSlippageBps = pendleSlippageBps_;
        valuationDiscountBps = valuationDiscountBps_;
        twapDuration = twapDuration_;
        maxRateStaleness = 1 hours; // balanceOf trusts a fallback rate at most this long past a dead oracle (G-3)
    }

    // --- owner controls ---

    /// @notice Retune the swap floors (owner / Safe). Widening is the lever to exit a depegged or
    ///         illiquid market at a controlled haircut instead of reverting forever.
    function setSlippageBps(uint256 uniBps, uint256 pendleBps) external onlyOwner {
        if (uniBps == 0 || uniBps >= 10_000 || pendleBps == 0 || pendleBps >= 10_000) revert BadParam();
        if (valuationDiscountBps > uniBps + pendleBps) revert BadParam();
        uniSlippageBps = uniBps;
        pendleSlippageBps = pendleBps;
        emit SlippageUpdated(uniBps, pendleBps);
    }

    /// @notice Retune the valuation discount used in balanceOf (owner / Safe).
    function setValuationDiscountBps(uint256 bps) external onlyOwner {
        if (bps > uniSlippageBps + pendleSlippageBps) revert BadParam();
        valuationDiscountBps = bps;
        emit ValuationDiscountUpdated(bps);
    }

    /// @notice Retune the PT oracle TWAP window (owner / Safe). Longer is harder to manipulate but
    ///         needs more observation history; the market's cardinality must support it.
    function setTwapDuration(uint32 seconds_) external onlyOwner {
        if (seconds_ == 0) revert BadParam();
        twapDuration = seconds_;
        emit TwapDurationUpdated(seconds_);
    }

    /// @notice Retune how long balanceOf will keep trusting the last good rate after the oracle stops
    ///         responding (owner / Safe). Shorter is safer against a stale-NAV arbitrage during a
    ///         prolonged oracle outage (G-3); longer tolerates more downtime before the venue drops
    ///         out of NAV. Money-path reads (_rateLive) are unaffected — they still revert on a dead
    ///         oracle, so no one can enter or exit this venue at a stale price regardless of this.
    function setMaxRateStaleness(uint256 seconds_) external onlyOwner {
        maxRateStaleness = seconds_;
        emit MaxRateStalenessUpdated(seconds_);
    }

    function asset() external view returns (address) {
        return address(token);
    }

    // --- money path ---

    function deposit(uint256 amount) external onlyVault returns (uint256 supplied) {
        token.safeTransferFrom(msg.sender, address(this), amount);
        // USDT0 -> USDG (floored), then USDG -> PT on Pendle (floored). Report the realized PT value
        // that reached the venue after BOTH entry legs (not the intermediate USDG), so the pool's
        // per-epoch loss budget bounds the full entry cost, including the Pendle-leg slippage (F-1).
        uint256 gotUsdg = _uniSwap(token, address(usdg), amount, _floor(amount, uniSlippageBps));
        return _buyPt(gotUsdg);
    }

    /// @dev Buy PT with `usdgIn` USDG. Value the buy at the TWAP rate and floor the PT received so a
    ///      thin or manipulated market reverts. guessMax bounds the router's on-chain search a little
    ///      above the oracle-implied amount; guessMin stays 0 so the search always converges, and
    ///      minPtOut is the hard safety floor.
    function _buyPt(uint256 usdgIn) internal returns (uint256 ptValue) {
        uint256 rate = _rateLive(); // 1e18: USDG per PT (par-clamped; caches the NAV fallback)
        uint256 expectedPt = (usdgIn * 1e18) / rate; // PT is cheaper than par, so more PT than USDG
        uint256 minPtOut = (expectedPt * (10_000 - pendleSlippageBps)) / 10_000;

        usdg.forceApprove(address(router), usdgIn);
        (uint256 netPtOut,,) = router.swapExactTokenForPt(
            address(this),
            market,
            minPtOut,
            ApproxParams({guessMin: 0, guessMax: (expectedPt * 105) / 100, guessOffchain: 0, maxIteration: 30, eps: 1e14}),
            TokenInput({tokenIn: address(usdg), netTokenIn: usdgIn, tokenMintSy: address(usdg), pendleSwap: address(0), swapData: _noSwap()}),
            _noLimit()
        );
        usdg.forceApprove(address(router), 0);
        require(netPtOut >= minPtOut, "pt floor");
        // Realized asset value of the PT actually received, at the same par-clamped TWAP `rate`. This
        // is the value that reached the venue AFTER the USDG->PT leg, so `deposit` reports it as
        // `supplied` and the pool's per-epoch loss budget meters the Pendle-leg slippage too (F-1).
        // Valuing at `rate` recovers ~usdgIn on a fair fill and drops only by realized slippage, so the
        // fixed-yield discount is never miscounted as a loss.
        return (netPtOut * rate) / 1e18;
    }

    function withdraw(uint256 amount) external onlyVault returns (uint256 withdrawn) {
        uint256 ptBal = pt.balanceOf(address(this));
        if (ptBal == 0) return 0;
        // `amount` is in USDT0 (~USDG) terms. Sell just enough PT to cover it, or all on the max
        // sentinel / an over-ask. Sizing uses the same TWAP value the pool sees.
        uint256 curVal = _valueUsdgLive(ptBal);
        uint256 ptToSell =
            (amount == type(uint256).max || amount >= curVal || curVal == 0) ? ptBal : (ptBal * amount) / curVal;
        if (ptToSell == 0) return 0;

        uint256 gotUsdg = _ptToUsdg(ptToSell, pendleSlippageBps);
        uint256 gotUsdt = _uniSwap(usdg, address(token), gotUsdg, _floor(gotUsdg, uniSlippageBps));
        token.safeTransfer(vault, gotUsdt);
        return gotUsdt;
    }

    /// @notice Owner escape hatch: liquidate the entire PT position back to USDT0 at a caller-supplied
    ///         final floor and return it to the vault. For stress where the normal floors revert and
    ///         the agent cannot exit; the owner accepts a controlled haircut. `minUsdtOut` must be set
    ///         deliberately (never 0 in practice) — the owner is trusted here.
    function emergencyWithdraw(uint256 minUsdtOut) external onlyOwner returns (uint256 got) {
        uint256 ptBal = pt.balanceOf(address(this));
        if (ptBal == 0) return 0;
        uint256 gotUsdg = _ptToUsdg(ptBal, 0); // accept any PT->USDG output; the real floor is below
        got = _uniSwap(usdg, address(token), gotUsdg, minUsdtOut);
        token.safeTransfer(vault, got);
    }

    /// @notice Realizable value in USDT0 terms: PT held, valued by the TWAP oracle and haircut by
    ///         `valuationDiscountBps` (the marginal round-trip cost). At/after maturity the oracle
    ///         rate is ~1e18, so this converges to the redeemable face value.
    function balanceOf(address) external view returns (uint256) {
        uint256 ptBal = pt.balanceOf(address(this));
        if (ptBal == 0) return 0;
        uint256 usdgVal = (ptBal * _rateView()) / 1e18; // fail-open NAV; USDG ~ USDT0 (both 6dp)
        return (usdgVal * (10_000 - valuationDiscountBps)) / 10_000;
    }

    // --- internals ---

    /// @dev Sell `ptAmount` PT for USDG, flooring output at the TWAP value minus `slippageBps`. Uses
    ///      the market before maturity and the 1:1 redeem after.
    function _ptToUsdg(uint256 ptAmount, uint256 slippageBps) internal returns (uint256 gotUsdg) {
        uint256 minUsdg = slippageBps == 0 ? 0 : (_valueUsdgLive(ptAmount) * (10_000 - slippageBps)) / 10_000;
        pt.forceApprove(address(router), ptAmount);
        TokenOutput memory out = TokenOutput({
            tokenOut: address(usdg),
            minTokenOut: minUsdg,
            tokenRedeemSy: address(usdg),
            pendleSwap: address(0),
            swapData: _noSwap()
        });
        if (IPendleMarket(market).isExpired()) {
            (gotUsdg,) = router.redeemPyToToken(address(this), yt, ptAmount, out);
        } else {
            (gotUsdg,,) = router.swapExactPtForToken(address(this), market, ptAmount, out, _noLimit());
        }
        pt.forceApprove(address(router), 0); // never leave a standing allowance
    }

    /// @dev PT is clamped to par (1e18): a Principal Token redeems exactly 1:1 for the asset at
    ///      maturity and trades at a discount before it, so it can never be worth MORE than par.
    ///      Clamping caps any oracle overvaluation (a thin-market TWAP push, or a bad return) at the
    ///      true ceiling, so NAV — and therefore share price — cannot be inflated above face value.
    function _clampRate(uint256 r) internal pure returns (uint256) {
        return r > 1e18 ? 1e18 : r;
    }

    /// @dev Live rate for the money path. Caches it as the NAV fallback. May revert if the oracle is
    ///      not ready — that fails the deposit/withdraw safely; the pool is unaffected.
    function _rateLive() internal returns (uint256 r) {
        r = _clampRate(ptOracle.getPtToAssetRate(market, twapDuration));
        lastGoodRate = r;
        lastGoodRateAt = block.timestamp;
    }

    /// @dev Rate for NAV reads. If the oracle reverts, fall back to the last good (par-clamped) rate
    ///      so a Pendle oracle hiccup can never brick pool-wide totalAssets (F-1/F-5) — but ONLY while
    ///      that fallback is fresher than `maxRateStaleness`. Past that, a persistently dead oracle
    ///      must not keep feeding a stale NAV a depositor/redeemer could arbitrage (G-3): return 0 so
    ///      the venue drops out of NAV entirely (exactly as an impaired venue does) until the oracle
    ///      recovers or the owner prunes it. Zero is the conservative, continuous choice at the bound;
    ///      the money path (_rateLive) still reverts on a dead oracle, so no one can enter or exit
    ///      THIS venue at a stale price — only the read-only NAV is affected.
    function _rateView() internal view returns (uint256 r) {
        try ptOracle.getPtToAssetRate(market, twapDuration) returns (uint256 live) {
            r = _clampRate(live);
        } catch {
            if (lastGoodRateAt == 0 || block.timestamp - lastGoodRateAt > maxRateStaleness) return 0;
            r = lastGoodRate;
        }
    }

    /// @dev PT amount -> USDG value at the live rate (both 6dp; rate is 1e18-scaled). Money-path only.
    function _valueUsdgLive(uint256 ptAmount) internal returns (uint256) {
        return (ptAmount * _rateLive()) / 1e18;
    }

    function _uniSwap(IERC20 tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 out)
    {
        tokenIn.forceApprove(address(uniRouter), amountIn);
        out = uniRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(tokenIn),
                tokenOut: tokenOut,
                fee: uniPoolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        tokenIn.forceApprove(address(uniRouter), 0);
    }

    function _floor(uint256 amountIn, uint256 slippageBps) internal pure returns (uint256) {
        return (amountIn * (10_000 - slippageBps)) / 10_000;
    }

    function _noSwap() internal pure returns (SwapData memory s) {
        // zero-initialized: swapType NONE, no external router, no calldata
    }

    function _noLimit() internal pure returns (LimitOrderData memory l) {
        // zero-initialized: no limit router, empty fill arrays
    }
}
