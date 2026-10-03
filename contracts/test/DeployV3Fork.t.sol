// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DeployV3Mainnet} from "../script/DeployV3Mainnet.s.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {ZapDeposit} from "../src/ZapDeposit.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {RwaUsdgAdapter} from "../src/adapters/RwaUsdgAdapter.sol";
import {PendlePtAdapter} from "../src/adapters/PendlePtAdapter.sol";
import {UniV3LpAdapter} from "../src/adapters/UniV3LpAdapter.sol";
import {Erc4626Adapter} from "../src/adapters/Erc4626Adapter.sol";
import {SelfHostedEquityOracle} from "../src/oracles/SelfHostedEquityOracle.sol";
import {IVenueAdapter} from "../src/interfaces/IVenueAdapter.sol";

interface IQuoterV2Fork {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (uint256 amountOut, uint160[] memory, uint32[] memory, uint256);
}

/// @dev A venue that pays out `lossBps` short on exit (never reverts), to drive the realizable-
///      settlement bound on a real v3 pool: <= 5% short settles, > 5% short must revert.
contract ShortPayingVenue is IVenueAdapter {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    mapping(address => uint256) public position;
    uint256 public lossBps;

    constructor(address token_) {
        token = IERC20(token_);
    }

    function setLossBps(uint256 bps) external {
        lossBps = bps;
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
        uint256 out = (amt * (10_000 - lossBps)) / 10_000;
        token.safeTransfer(msg.sender, out);
        return out;
    }

    function balanceOf(address account) external view returns (uint256) {
        return position[account];
    }
}

/// @notice X Layer MAINNET FORK proof of the v3 redeploy (script/DeployV3Mainnet.s.sol).
///         setUp runs the real deploy script on a fork, cloning every live v2 pool family (stocks,
///         basket, gold, and the opt-in stable family + zap) from the live owner. The tests then:
///           1. compare every configured parameter of each v3 contract against the live v2 contract
///              it was cloned from (read on the fork), including the full venue allowlist + order;
///           2. drive deposit -> agent allocate -> agent deallocate -> redeem through the REAL live
///              venues (Uniswap v3 xStock/PAXGy routes, Aave, Spark spUSDT, the USDG RWA leg, Pendle
///              PT-USDG, the USDG/USDT0 LP), pricing the live shared oracle from live quotes;
///           3. prove the shortfall path: a failed or >5%-short venue exit reverts redeem on v3 (the
///              holder keeps every share), while the same scenario on live v2 equity bytecode burns
///              the shares for idle cash, and on the live v2 stable pool simply reverts.
///
///         Run (pin a block so reruns hit foundry's RPC cache):
///           XLAYER_MAINNET_RPC=https://rpc.xlayer.tech V3_FORK_BLOCK=<block> \
///             forge test --match-contract DeployV3Fork -vv
///         or: forge test --match-contract DeployV3Fork --fork-url https://rpc.xlayer.tech -vv
///         Without a fork (no XLAYER_MAINNET_RPC, chainid != 196) every test is reported as skipped.
contract DeployV3ForkTest is Test, DeployV3Mainnet {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant QUOTER = 0xD1b797D92d87B688193A2B976eFc8D577D204343; // Uniswap v3 QuoterV2
    address constant AAVE_POOL = 0xE3F3Caefdd7180F884c01E57f65Df979Af84f116;
    address constant ORACLE = 0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2; // shared, reused by v3
    uint32 constant REGULAR = 2;

    bool internal forked;

    // v2 (live) and v3 (fresh) addresses, flattened from the script's Plan / Deployment.
    address[] internal v2StockPools;
    address[] internal v2StockAdapters;
    address[] internal v3StockPools;
    address[] internal v3StockAdapters;
    address internal v2Basket;
    address[] internal v2BasketAdapters;
    address internal v3Basket;
    address[] internal v3BasketAdapters;
    address internal v2Gold;
    address internal v2GoldAdapter;
    address internal v3Gold;
    address internal v3GoldAdapter;
    address internal v2Stable;
    address[] internal v2StableAdapters; // aave, usdg, pendle, lp, spUSDT (v2 allowlist order)
    address internal v3Stable;
    address[] internal v3StableAdapters;
    address internal v2Zap;
    address internal v3Zap;

    address internal user = address(0xA11CE);
    address internal user2 = address(0xB0B);

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function setUp() public {
        if (block.chainid != 196) {
            string memory rpc = vm.envOr("XLAYER_MAINNET_RPC", string(""));
            if (bytes(rpc).length == 0) return; // offline run: tests report as skipped
            uint256 blk = vm.envOr("V3_FORK_BLOCK", uint256(0));
            if (blk == 0) vm.createSelectFork(rpc);
            else vm.createSelectFork(rpc, blk);
        }
        forked = true;

        // The exact plan the owner broadcasts, with every family switched on (stable is opt-in on
        // mainnet; it is exercised here so the opt-in path is proven too).
        Plan memory p = planFromEnv();
        p.stocks = true;
        p.basket = true;
        p.gold = true;
        p.stable = true;
        p.startPaused = false;
        Deployment memory d = execute(p); // broadcasts from the live owner; reverts on any parity gap

        v2StockPools = p.stockPools;
        v2StockAdapters = p.stockAdapters;
        for (uint256 i; i < d.stocks.length; ++i) {
            v3StockPools.push(d.stocks[i].pool);
            v3StockAdapters.push(d.stocks[i].adapters[0]);
        }
        v2Basket = p.basketPool;
        v2BasketAdapters = p.basketAdapters;
        v3Basket = d.basket.pool;
        v3BasketAdapters = d.basket.adapters;
        v2Gold = p.goldPool;
        v2GoldAdapter = p.goldAdapter;
        v3Gold = d.gold.pool;
        v3GoldAdapter = d.gold.adapters[0];
        v2Stable = p.stablePool;
        v2StableAdapters.push(p.stableAave);
        v2StableAdapters.push(p.stableUsdg);
        v2StableAdapters.push(p.stablePendle);
        v2StableAdapters.push(p.stableLp);
        v2StableAdapters.push(p.stableSpUsdt);
        v3Stable = d.stable.pool;
        v3StableAdapters.push(d.stable.aave);
        v3StableAdapters.push(d.stable.usdg);
        v3StableAdapters.push(d.stable.pendle);
        v3StableAdapters.push(d.stable.lp);
        v3StableAdapters.push(d.stable.spUsdt);
        v2Zap = p.zap;
        v3Zap = d.stable.zap;
    }

    // ================================================================== 1. parity with live v2

    function test_fork_parity_everyParameterMatchesLiveV2() public onlyFork {
        for (uint256 i; i < v3StockPools.length; ++i) {
            _assertEquityPoolParity(v2StockPools[i], v3StockPools[i]);
            address[] memory a2 = new address[](1);
            address[] memory a3 = new address[](1);
            a2[0] = v2StockAdapters[i];
            a3[0] = v3StockAdapters[i];
            _assertVenueListParity(v2StockPools[i], 26, v3StockPools[i], a2, a3);
            _logPair("stock", v2StockPools[i], v3StockPools[i]);
        }
        _assertEquityPoolParity(v2Basket, v3Basket);
        _assertVenueListParity(v2Basket, 26, v3Basket, v2BasketAdapters, v3BasketAdapters);
        _logPair("basket", v2Basket, v3Basket);

        _assertEquityPoolParity(v2Gold, v3Gold);
        address[] memory g2 = new address[](1);
        address[] memory g3 = new address[](1);
        g2[0] = v2GoldAdapter;
        g3[0] = v3GoldAdapter;
        _assertVenueListParity(v2Gold, 26, v3Gold, g2, g3);
        _logPair("gold", v2Gold, v3Gold);

        _assertPoolPolicyParity(v2Stable, v3Stable, false);
        _assertStableAdapterParity();
        _logPair("stable", v2Stable, v3Stable);

        ZapDeposit z2 = ZapDeposit(v2Zap);
        ZapDeposit z3 = ZapDeposit(v3Zap);
        assertEq(address(z3.pool()), v3Stable, "zap -> v3 pool");
        assertEq(address(z3.router()), address(z2.router()), "zap router");
        assertEq(address(z3.usdt0()), address(z2.usdt0()), "zap asset");
    }

    function _logPair(string memory label, address v2, address v3) internal view {
        AumoPool b = AumoPool(v3);
        console2.log(string.concat("[parity ok] ", label, " v2"), v2);
        console2.log("             -> v3", v3);
        console2.log("   owner / agent", b.owner(), b.agent());
        console2.log("   maxMove / perVenue / maxTotal", b.maxMoveSize(), b.perVenueCap(), b.maxTotalDeployed());
        console2.log("   loss / deploy budget", b.maxEpochLoss(), b.maxEpochDeploy());
        console2.log("   levy entry / exit bps", b.entryFeeBps(), b.exitFeeBps());
    }

    function _assertPoolPolicyParity(address v2, address v3, bool v2HasLevy) internal view {
        AumoPool a = AumoPool(v2);
        AumoPool b = AumoPool(v3);
        assertEq(b.MAX_EXIT_SHORTFALL_BPS(), 500, "v3 carries the shortfall guard");
        (bool hasGuard,) = v2.staticcall(abi.encodeWithSignature("MAX_EXIT_SHORTFALL_BPS()"));
        assertFalse(hasGuard, "live v2 has no shortfall guard (pre-fix bytecode)");
        assertEq(b.asset(), a.asset(), "asset");
        assertEq(b.owner(), a.owner(), "owner");
        assertEq(b.pendingOwner(), a.pendingOwner(), "pendingOwner");
        assertEq(b.agent(), a.agent(), "agent");
        assertEq(b.paused(), a.paused(), "paused");
        assertEq(b.maxMoveSize(), a.maxMoveSize(), "maxMoveSize");
        assertEq(b.perVenueCap(), a.perVenueCap(), "perVenueCap");
        assertEq(b.maxTotalDeployed(), a.maxTotalDeployed(), "maxTotalDeployed");
        assertEq(b.maxEpochLoss(), a.maxEpochLoss(), "maxEpochLoss");
        assertEq(b.lossEpochLength(), a.lossEpochLength(), "lossEpochLength");
        assertEq(b.maxEpochDeploy(), a.maxEpochDeploy(), "maxEpochDeploy");
        assertEq(b.deployEpochLength(), a.deployEpochLength(), "deployEpochLength");
        assertEq(b.decimals(), a.decimals(), "share decimals");
        assertEq(b.name(), a.name(), "name");
        assertEq(b.symbol(), a.symbol(), "symbol");
        if (v2HasLevy) {
            assertEq(b.entryFeeBps(), a.entryFeeBps(), "entryFeeBps");
            assertEq(b.exitFeeBps(), a.exitFeeBps(), "exitFeeBps");
        } else {
            // The live stable pool predates the levy (no getter); v3 must keep it off.
            (bool ok,) = v2.staticcall(abi.encodeWithSignature("entryFeeBps()"));
            assertFalse(ok, "v2 stable has no levy getter");
            assertEq(b.entryFeeBps(), 0, "stable entry levy off");
            assertEq(b.exitFeeBps(), 0, "stable exit levy off");
        }
    }

    function _assertEquityPoolParity(address v2, address v3) internal view {
        _assertPoolPolicyParity(v2, v3, true);
        EquityPool a = EquityPool(v2);
        EquityPool b = EquityPool(v3);
        assertEq(address(b.marketOracle()), address(a.marketOracle()), "marketOracle");
        assertEq(b.marketFeedId(), a.marketFeedId(), "marketFeedId");
        assertEq(b.marketMaxAge(), a.marketMaxAge(), "marketMaxAge");
    }

    /// @dev Read the private `_venues` array from both generations' storage and require the same
    ///      venues (by adapter config), same order, each allowlisted and bound to its own pool.
    function _assertVenueListParity(
        address v2,
        uint256 v2Slot,
        address v3,
        address[] memory v2Adapters,
        address[] memory v3Adapters
    ) internal view {
        address[] memory l2 = _venueList(v2, v2Slot);
        address[] memory l3 = _venueList(v3, 26);
        assertEq(l2.length, l3.length, "venue count");
        assertEq(l2.length, v2Adapters.length, "v2 venue list == plan");
        for (uint256 i; i < l2.length; ++i) {
            assertEq(l2[i], v2Adapters[i], "v2 venue order");
            assertEq(l3[i], v3Adapters[i], "v3 venue order");
            assertTrue(AumoPool(v3).venueAllowed(l3[i]), "v3 venue allowed");
            assertEq(AumoPool(v3).venueAllowed(l3[i]), AumoPool(v2).venueAllowed(l2[i]), "allowed parity");
            assertEq(AumoPool(v3).venueImpaired(l3[i]), AumoPool(v2).venueImpaired(l2[i]), "impaired parity");
            EquityAdapter x = EquityAdapter(l2[i]);
            EquityAdapter y = EquityAdapter(l3[i]);
            assertEq(x.vault(), v2, "v2 adapter bound to v2");
            assertEq(y.vault(), v3, "v3 adapter bound to v3");
            assertEq(address(y.token()), address(x.token()), "adapter token");
            assertEq(address(y.stock()), address(x.stock()), "adapter stock");
            assertEq(address(y.oracle()), address(x.oracle()), "adapter oracle");
            assertEq(y.feedId(), x.feedId(), "adapter feedId");
            assertEq(address(y.router()), address(x.router()), "adapter router");
            assertEq(y.buyPath(), x.buyPath(), "adapter buyPath");
            assertEq(y.sellPath(), x.sellPath(), "adapter sellPath");
            assertEq(y.maxAge(), x.maxAge(), "adapter maxAge");
            assertEq(y.slippageBps(), x.slippageBps(), "adapter slippageBps");
        }
    }

    function _venueList(address pool, uint256 slot) internal view returns (address[] memory out) {
        uint256 n = uint256(vm.load(pool, bytes32(slot)));
        out = new address[](n);
        uint256 base = uint256(keccak256(abi.encode(slot)));
        for (uint256 i; i < n; ++i) {
            out[i] = address(uint160(uint256(vm.load(pool, bytes32(base + i)))));
        }
    }

    function _assertStableAdapterParity() internal view {
        address[] memory l2 = _venueList(v2Stable, 24); // b95ed0b layout
        address[] memory l3 = _venueList(v3Stable, 26);
        assertEq(l2.length, 5, "v2 stable has exactly 5 venues");
        assertEq(l3.length, 5, "v3 stable has 5 venues");
        for (uint256 i; i < 5; ++i) {
            assertEq(l2[i], v2StableAdapters[i], "v2 stable venue order");
            assertEq(l3[i], v3StableAdapters[i], "v3 stable venue order");
            assertTrue(AumoPool(v3Stable).venueAllowed(l3[i]), "v3 stable venue allowed");
            assertTrue(AumoPool(v2Stable).venueAllowed(l2[i]), "v2 stable venue allowed");
            assertEq(AumoPool(v3Stable).venueImpaired(l3[i]), AumoPool(v2Stable).venueImpaired(l2[i]), "impaired");
        }

        AaveV3Adapter a2 = AaveV3Adapter(l2[0]);
        AaveV3Adapter a3 = AaveV3Adapter(l3[0]);
        assertEq(a3.vault(), v3Stable, "aave vault");
        assertEq(address(a3.token()), address(a2.token()), "aave token");
        assertEq(address(a3.pool()), address(a2.pool()), "aave pool");
        assertEq(address(a3.aToken()), address(a2.aToken()), "aave aToken");

        RwaUsdgAdapter u2 = RwaUsdgAdapter(l2[1]);
        RwaUsdgAdapter u3 = RwaUsdgAdapter(l3[1]);
        assertEq(u3.vault(), v3Stable, "usdg vault");
        assertEq(address(u3.usdg()), address(u2.usdg()), "usdg token");
        assertEq(address(u3.aUsdg()), address(u2.aUsdg()), "usdg aToken");
        assertEq(address(u3.pool()), address(u2.pool()), "usdg aave pool");
        assertEq(address(u3.router()), address(u2.router()), "usdg router");
        assertEq(u3.owner(), u2.owner(), "usdg owner");
        assertEq(u3.poolFee(), u2.poolFee(), "usdg fee");
        assertEq(u3.maxSlippageBps(), u2.maxSlippageBps(), "usdg slippage");
        assertEq(u3.valuationDiscountBps(), u2.valuationDiscountBps(), "usdg valuation");

        PendlePtAdapter e2 = PendlePtAdapter(l2[2]);
        PendlePtAdapter e3 = PendlePtAdapter(l3[2]);
        assertEq(e3.vault(), v3Stable, "pendle vault");
        assertEq(e3.market(), e2.market(), "pendle market");
        assertEq(address(e3.pt()), address(e2.pt()), "pendle pt");
        assertEq(e3.yt(), e2.yt(), "pendle yt");
        assertEq(address(e3.router()), address(e2.router()), "pendle router");
        assertEq(address(e3.ptOracle()), address(e2.ptOracle()), "pendle oracle");
        assertEq(address(e3.uniRouter()), address(e2.uniRouter()), "pendle uni router");
        assertEq(e3.owner(), e2.owner(), "pendle owner");
        assertEq(e3.uniPoolFee(), e2.uniPoolFee(), "pendle uni fee");
        assertEq(e3.uniSlippageBps(), e2.uniSlippageBps(), "pendle uni slippage");
        assertEq(e3.pendleSlippageBps(), e2.pendleSlippageBps(), "pendle slippage");
        assertEq(e3.valuationDiscountBps(), e2.valuationDiscountBps(), "pendle valuation");
        assertEq(e3.twapDuration(), e2.twapDuration(), "pendle twap");
        assertEq(e3.maxRateStaleness(), e2.maxRateStaleness(), "pendle staleness");

        UniV3LpAdapter p2 = UniV3LpAdapter(l2[3]);
        UniV3LpAdapter p3 = UniV3LpAdapter(l3[3]);
        assertEq(p3.vault(), v3Stable, "lp vault");
        assertEq(address(p3.pool()), address(p2.pool()), "lp pool");
        assertEq(address(p3.router()), address(p2.router()), "lp router");
        assertEq(p3.owner(), p2.owner(), "lp owner");
        assertEq(p3.poolFee(), p2.poolFee(), "lp fee");
        assertEq(p3.usdgIsToken0(), p2.usdgIsToken0(), "lp orientation");
        assertEq(p3.maxSlippageBps(), p2.maxSlippageBps(), "lp slippage");
        assertEq(p3.valuationDiscountBps(), p2.valuationDiscountBps(), "lp valuation");

        Erc4626Adapter s2 = Erc4626Adapter(l2[4]);
        Erc4626Adapter s3 = Erc4626Adapter(l3[4]);
        assertEq(s3.vault(), v3Stable, "spUSDT vault");
        assertEq(address(s3.venue()), address(s2.venue()), "spUSDT venue");
        assertEq(address(s3.token()), address(s2.token()), "spUSDT token");
    }

    // ================================================================== oracle + flow helpers

    /// @dev Post a fresh REGULAR-session price on the live shared oracle as its owner (forceResync
    ///      bypasses the 10% circuit breaker so a test can also post a deliberately skewed mark).
    function _mark(bytes32 feed, uint256 pxWad) internal {
        SelfHostedEquityOracle o = SelfHostedEquityOracle(ORACLE);
        (uint32 last,) = o.lastObservation(feed);
        if (uint256(last) >= block.timestamp) vm.warp(uint256(last) + 1);
        vm.prank(o.owner());
        o.forceResync(feed, pxWad, REGULAR, uint32(block.timestamp));
    }

    function _stockDec(EquityAdapter a) internal view returns (uint256) {
        return IERC20Metadata(address(a.stock())).decimals();
    }

    /// @dev Live price (USD/share, WAD) a buy of `usdtIn` fills at on the adapter's real route.
    function _buyPx(EquityAdapter a, uint256 usdtIn) internal returns (uint256) {
        (uint256 out,,,) = IQuoterV2Fork(QUOTER).quoteExactInput(a.buyPath(), usdtIn);
        require(out > 0, "no buy quote");
        return (usdtIn * 10 ** (12 + _stockDec(a))) / out;
    }

    /// @dev Live price (USD/share, WAD) selling the adapter's whole holding realizes.
    function _sellPx(EquityAdapter a) internal returns (uint256) {
        uint256 held = a.stock().balanceOf(address(a));
        require(held > 0, "nothing held");
        (uint256 out,,,) = IQuoterV2Fork(QUOTER).quoteExactInput(a.sellPath(), held);
        return (out * 10 ** (12 + _stockDec(a))) / held;
    }

    function _deposit(address pool, address who, uint256 amount) internal returns (uint256 shares) {
        deal(USDT0, who, IERC20(USDT0).balanceOf(who) + amount);
        vm.startPrank(who);
        IERC20(USDT0).approve(pool, amount);
        shares = AumoPool(pool).deposit(amount, who);
        vm.stopPrank();
        assertGt(shares, 0, "shares minted");
    }

    function _allocate(address pool, address venue, uint256 amount) internal {
        vm.prank(AumoPool(pool).agent());
        AumoPool(pool).allocate(venue, amount, bytes32("v3-fork"));
    }

    function _deallocate(address pool, address venue, uint256 amount) internal {
        vm.prank(AumoPool(pool).agent());
        AumoPool(pool).deallocate(venue, amount);
    }

    function _redeemAll(address pool, address who) internal returns (uint256 got) {
        uint256 sh = AumoPool(pool).balanceOf(who);
        uint256 before = IERC20(USDT0).balanceOf(who);
        vm.prank(who);
        AumoPool(pool).redeem(sh, who, who);
        got = IERC20(USDT0).balanceOf(who) - before;
    }

    /// @dev deposit -> allocate -> partial deallocate -> full redeem on one single-venue equity pool.
    function _equityLifecycle(string memory label, address pool, address adapterAddr) internal {
        EquityAdapter a = EquityAdapter(adapterAddr);
        bytes32 feed = a.feedId();
        uint256 dep = 200e6;
        uint256 alloc = 150e6;

        _mark(feed, _buyPx(a, alloc));
        assertTrue(EquityPool(pool).marketOpen(), "market open on a fresh mark");
        uint256 shares = _deposit(pool, user, dep);
        assertEq(AumoPool(pool).totalAssets(), dep, "assets == deposit");

        _allocate(pool, adapterAddr, alloc);
        assertGt(a.stock().balanceOf(adapterAddr), 0, "adapter bought the asset on the live route");
        assertApproxEqRel(AumoPool(pool).totalAssets(), dep, 0.02e18, "NAV holds across the buy");

        _mark(feed, _sellPx(a));
        uint256 idleBefore = AumoPool(pool).idleBalance();
        _deallocate(pool, adapterAddr, 50e6);
        assertApproxEqRel(AumoPool(pool).idleBalance() - idleBefore, 50e6, 0.02e18, "partial retreat");

        _mark(feed, _sellPx(a));
        uint256 got = _redeemAll(pool, user);
        assertEq(AumoPool(pool).balanceOf(user), 0, "all shares redeemed");
        assertApproxEqRel(got, dep, 0.03e18, "round trip returns ~deposit (levy + spread)");
        console2.log(string.concat("[lifecycle ok] ", label, " deposit / shares / redeemed"), dep, shares, got);
    }

    /// @dev Allocate everything, push the oracle mark 10% above what the live route can realize so
    ///      the adapter's oracle floor makes the exit swap revert, then redeem.
    function _breakExit(address pool, address adapterAddr) internal returns (uint256 shares) {
        EquityAdapter a = EquityAdapter(adapterAddr);
        bytes32 feed = a.feedId();
        _mark(feed, _buyPx(a, 100e6));
        shares = _deposit(pool, user, 100e6);
        _allocate(pool, adapterAddr, AumoPool(pool).idleBalance());
        _mark(feed, (_sellPx(a) * 110) / 100);
    }

    // ================================================================== 2. lifecycle on live venues

    function test_fork_stocks_lifecycle_onLiveRoutes() public onlyFork {
        string[4] memory names = ["NVDA", "AAPL", "MSFT", "META"];
        for (uint256 i; i < v3StockPools.length; ++i) {
            _equityLifecycle(names[i], v3StockPools[i], v3StockAdapters[i]);
        }
    }

    function test_fork_gold_lifecycle_onLiveRoute() public onlyFork {
        _equityLifecycle("PAXGY", v3Gold, v3GoldAdapter);
    }

    function test_fork_basket_lifecycle_and_singleVenueOutage() public onlyFork {
        uint256 n = v3BasketAdapters.length;
        for (uint256 i; i < n; ++i) {
            EquityAdapter a = EquityAdapter(v3BasketAdapters[i]);
            _mark(a.feedId(), _buyPx(a, 90e6));
        }
        _deposit(v3Basket, user, 400e6);
        for (uint256 i; i < n; ++i) {
            _allocate(v3Basket, v3BasketAdapters[i], 90e6);
        }
        assertApproxEqRel(AumoPool(v3Basket).totalAssets(), 400e6, 0.02e18, "basket NAV holds");

        // partial retreat from one leg
        EquityAdapter aapl = EquityAdapter(v3BasketAdapters[1]);
        _mark(aapl.feedId(), _sellPx(aapl));
        _deallocate(v3Basket, address(aapl), 20e6);

        // META's exit breaks (mark 10% above what its route can realize); the rest are healthy
        for (uint256 i; i < n; ++i) {
            EquityAdapter a = EquityAdapter(v3BasketAdapters[i]);
            uint256 px = _sellPx(a);
            _mark(a.feedId(), i == n - 1 ? (px * 110) / 100 : px);
        }
        uint256 sh = AumoPool(v3Basket).balanceOf(user);
        vm.prank(user);
        vm.expectPartialRevert(AumoPool.ExitShortfall.selector);
        AumoPool(v3Basket).redeem(sh, user, user);
        assertEq(AumoPool(v3Basket).balanceOf(user), sh, "full exit with a dead leg reverts, shares intact");

        // half the position is still redeemable from the healthy legs (venue isolation)
        uint256 half = sh / 2;
        vm.prank(user);
        uint256 gotHalf = AumoPool(v3Basket).redeem(half, user, user);
        assertApproxEqRel(gotHalf, 200e6, 0.03e18, "half exit served by healthy legs");

        // META recovers: the rest exits
        EquityAdapter meta = EquityAdapter(v3BasketAdapters[n - 1]);
        _mark(meta.feedId(), _sellPx(meta));
        for (uint256 i; i < n - 1; ++i) {
            EquityAdapter a = EquityAdapter(v3BasketAdapters[i]);
            if (a.stock().balanceOf(address(a)) > 0) _mark(a.feedId(), _sellPx(a));
        }
        uint256 gotRest = _redeemAll(v3Basket, user);
        assertEq(AumoPool(v3Basket).balanceOf(user), 0, "fully exited after recovery");
        assertApproxEqRel(gotHalf + gotRest, 400e6, 0.03e18, "whole basket round trip ~deposit");
        console2.log("[basket ok] half-exit during outage / rest after recovery", gotHalf, gotRest);
    }

    function test_fork_stable_lifecycle_onLiveVenues() public onlyFork {
        address[] memory v = v3StableAdapters; // aave, usdg, pendle, lp, spUSDT
        _deposit(v3Stable, user, 300e6);
        _allocate(v3Stable, v[0], 60e6); // Aave v3 USDT0
        _allocate(v3Stable, v[4], 60e6); // Spark spUSDT
        _allocate(v3Stable, v[1], 50e6); // USDT0 -> USDG -> Aave
        _allocate(v3Stable, v[2], 30e6); // USDT0 -> USDG -> Pendle PT
        _allocate(v3Stable, v[3], 30e6); // full-range USDG/USDT0 LP
        for (uint256 i; i < 5; ++i) {
            assertGt(IVenueAdapter(v[i]).balanceOf(v3Stable), 0, "live venue holds value");
        }
        assertApproxEqRel(AumoPool(v3Stable).totalAssets(), 300e6, 0.01e18, "stable NAV holds");

        uint256 idle0 = AumoPool(v3Stable).idleBalance();
        _deallocate(v3Stable, v[0], 20e6); // lossless
        _deallocate(v3Stable, v[1], 10e6); // through the USDG exit swap (metered)
        assertApproxEqRel(AumoPool(v3Stable).idleBalance() - idle0, 30e6, 0.01e18, "partial retreats");

        uint256 got = _redeemAll(v3Stable, user);
        assertEq(AumoPool(v3Stable).balanceOf(user), 0, "all shares redeemed");
        assertApproxEqRel(got, 300e6, 0.01e18, "stable round trip ~deposit");
        console2.log("[stable ok] deposit 300e6 across 5 live venues, redeemed", got);
    }

    function test_fork_zap_depositsIntoV3Pool() public onlyFork {
        deal(USDG, user, 50e6);
        vm.startPrank(user);
        IERC20(USDG).approve(v3Zap, 50e6);
        uint256 shares = ZapDeposit(v3Zap).zapDeposit(USDG, 100, 50e6, 49e6, user);
        vm.stopPrank();
        assertGt(shares, 0, "zap minted v3 shares");
        assertEq(AumoPool(v3Stable).balanceOf(user), shares, "shares on the v3 pool");
        assertEq(AumoPool(v2Stable).balanceOf(user), 0, "nothing on v2");
    }

    // ================================================================== 3. the shortfall path

    /// The bug, side by side on live bytecode: a failed venue exit on v2 burns every share for the
    /// idle balance; on v3 the same redeem reverts ExitShortfall and the holder keeps the shares.
    function test_fork_shortfall_v2BurnsShares_v3Reverts_NVDA() public onlyFork {
        // --- v2 (live NVDA pool, pre-fix bytecode)
        address v2 = v2StockPools[0];
        uint256 v2Shares = _breakExit(v2, v2StockAdapters[0]);
        uint256 idle = AumoPool(v2).idleBalance();
        uint256 owed = AumoPool(v2).previewRedeem(v2Shares);
        uint256 v2Got = _redeemAll(v2, user);
        assertEq(AumoPool(v2).balanceOf(user), 0, "v2: every share burned");
        assertEq(v2Got, idle, "v2: paid only the idle balance");
        assertLt(v2Got * 20, owed, "v2: paid under 5% of what was owed");
        console2.log("[v2 bug reproduced] owed / paid after burning all shares", owed, v2Got);

        // --- v3 (fresh NVDA pool, fixed bytecode), same scenario
        address v3 = v3StockPools[0];
        uint256 v3Shares = _breakExit(v3, v3StockAdapters[0]);
        uint256 v3Owed = AumoPool(v3).previewRedeem(v3Shares);
        uint256 v3Idle = AumoPool(v3).idleBalance();
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(AumoPool.ExitShortfall.selector, v3Owed, v3Idle));
        AumoPool(v3).redeem(v3Shares, user, user);
        assertEq(AumoPool(v3).balanceOf(user), v3Shares, "v3: shares intact");
        console2.log("[v3 fixed] ExitShortfall(owed, payout)", v3Owed, v3Idle);

        // the venue recovers (mark back at the live route): the same holder exits whole
        EquityAdapter a = EquityAdapter(v3StockAdapters[0]);
        _mark(a.feedId(), _sellPx(a));
        uint256 got = _redeemAll(v3, user);
        assertApproxEqRel(got, 100e6, 0.03e18, "v3: made whole after recovery");
    }

    function test_fork_shortfall_everyEquityFamilyReverts() public onlyFork {
        address[] memory pools = new address[](v3StockPools.length + 1);
        address[] memory adapters = new address[](v3StockPools.length + 1);
        for (uint256 i; i < v3StockPools.length; ++i) {
            pools[i] = v3StockPools[i];
            adapters[i] = v3StockAdapters[i];
        }
        pools[v3StockPools.length] = v3Gold;
        adapters[v3StockPools.length] = v3GoldAdapter;
        for (uint256 i; i < pools.length; ++i) {
            uint256 sh = _breakExit(pools[i], adapters[i]);
            vm.prank(user);
            vm.expectPartialRevert(AumoPool.ExitShortfall.selector);
            AumoPool(pools[i]).redeem(sh, user, user);
            assertEq(AumoPool(pools[i]).balanceOf(user), sh, "shares intact");
        }
    }

    /// A small realizable shortfall (oracle 1% above the route) still settles; the bound only bites
    /// past 5%.
    function test_fork_equity_ordinarySlippage_stillSettles() public onlyFork {
        address pool = v3StockPools[0];
        EquityAdapter a = EquityAdapter(v3StockAdapters[0]);
        _mark(a.feedId(), _buyPx(a, 100e6));
        _deposit(pool, user, 100e6);
        _allocate(pool, address(a), AumoPool(pool).idleBalance());
        _mark(a.feedId(), (_sellPx(a) * 101) / 100);
        uint256 owed = AumoPool(pool).previewRedeem(AumoPool(pool).balanceOf(user));
        uint256 got = _redeemAll(pool, user);
        assertEq(AumoPool(pool).balanceOf(user), 0, "exited");
        assertLt(got, owed, "settled at realizable value, a little under the mark");
        assertGt(got * 10_000, owed * 9_500, "within the 5% bound");
    }

    /// Stable family: a real venue whose exit fails (Aave withdraw reverting, e.g. a paused reserve).
    /// v3 reverts ExitShortfall; the live v2 stable pool also reverts (it predates realizable
    /// settlement), which is why it is not part of the mandatory redeploy.
    function test_fork_shortfall_stable_aaveExitFails() public onlyFork {
        bytes memory aaveWithdraw = abi.encodeWithSignature("withdraw(address,uint256,address)");

        // v3
        uint256 sh3 = _deposit(v3Stable, user, 100e6);
        _allocate(v3Stable, v3StableAdapters[0], 100e6);
        vm.mockCallRevert(AAVE_POOL, aaveWithdraw, "reserve paused");
        vm.prank(user);
        vm.expectPartialRevert(AumoPool.ExitShortfall.selector);
        AumoPool(v3Stable).redeem(sh3, user, user);
        assertEq(AumoPool(v3Stable).balanceOf(user), sh3, "v3 stable: shares intact");
        vm.clearMockedCalls();
        assertApproxEqRel(_redeemAll(v3Stable, user), 100e6, 0.001e18, "v3 stable: whole after recovery");

        // v2 (live): same failure reverts too, shares intact (no burn-for-idle on this bytecode)
        uint256 sh2 = _deposit(v2Stable, user2, 100e6);
        _allocate(v2Stable, v2StableAdapters[0], 100e6);
        vm.mockCallRevert(AAVE_POOL, aaveWithdraw, "reserve paused");
        vm.prank(user2);
        vm.expectRevert();
        AumoPool(v2Stable).redeem(sh2, user2, user2);
        assertEq(AumoPool(v2Stable).balanceOf(user2), sh2, "v2 stable: shares intact");
        vm.clearMockedCalls();
    }

    /// A venue that RETURNS short (no revert): 10% short must revert, 2% short settles.
    function test_fork_shortPayingVenue_boundOnV3Pool() public onlyFork {
        ShortPayingVenue sv = new ShortPayingVenue(USDT0);
        vm.prank(AumoPool(v3Stable).owner());
        AumoPool(v3Stable).setVenueAllowed(address(sv), true);

        uint256 sh = _deposit(v3Stable, user, 100e6);
        _allocate(v3Stable, address(sv), 100e6);

        sv.setLossBps(1_000); // 10% short
        uint256 owed = AumoPool(v3Stable).previewRedeem(sh);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(AumoPool.ExitShortfall.selector, owed, (owed * 9_000) / 10_000));
        AumoPool(v3Stable).redeem(sh, user, user);
        assertEq(AumoPool(v3Stable).balanceOf(user), sh, "10% short: reverted, shares intact");

        sv.setLossBps(200); // 2% short, inside the bound
        uint256 got = _redeemAll(v3Stable, user);
        assertEq(AumoPool(v3Stable).balanceOf(user), 0, "2% short: settled");
        assertApproxEqAbs(got, (owed * 9_800) / 10_000, 2, "paid realizable value");
    }
}
