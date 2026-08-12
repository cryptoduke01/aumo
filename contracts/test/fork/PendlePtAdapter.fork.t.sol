// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../../src/AumoPool.sol";
import {PendlePtAdapter} from "../../src/adapters/PendlePtAdapter.sol";

/// @notice Fork test against real X Layer mainnet (chainId 196). Proves the Pendle fixed-yield venue
///         end to end: the pool's USDT0 is swapped to USDG on live Uniswap v3, used to buy the live
///         PT-USDG (matures 2026-10-29) on Pendle, valued through Pendle's TWAP oracle, and fully
///         exited back to USDT0 — both by selling PT on the market before maturity and by the 1:1
///         redeem after it. Runs only with RUN_FORK=1 + a mainnet RPC.
///
/// Verified X Layer mainnet addresses (Pendle live since 2026-08-11):
///   USDT0        0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   USDG         0x4ae46a509F6b1D9056937BA4500cb143933D2dc8
///   PendleRouterV4 0x888888888889758F76e7103c6CbF23ABbF58F946
///   PT-USDG market 0xcfb506cb34dd340e80d3df8764182a5187636032   (expiry 2026-10-29)
///   PendlePtOracle 0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2
///   UniV3Factory   0x4B2ab38DBF28D31D467aA8993f6c2585981D6804
///   SwapRouter02   0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA
interface IUniV3Factory {
    function getPool(address, address, uint24) external view returns (address);
}

interface IUniV3Pool {
    function liquidity() external view returns (uint128);
}

interface IPtOracleView {
    function getOracleState(address market, uint32 duration)
        external
        view
        returns (bool increaseCardinalityRequired, uint16 cardinalityRequired, bool oldestObservationSatisfied);
}

interface IPendleMarketCard {
    function increaseObservationsCardinalityNext(uint16 cardinalityNext) external;
    function expiry() external view returns (uint256);
}

contract PendlePtAdapterForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant ROUTER = 0x888888888889758F76e7103c6CbF23ABbF58F946;
    address constant MARKET = 0xcFB506cb34DD340e80d3dF8764182a5187636032;
    address constant PT_ORACLE = 0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2;
    address constant FACTORY = 0x4B2ab38DBF28D31D467aA8993f6c2585981D6804;
    address constant UNI_ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address alice = makeAddr("alice");

    AumoPool pool;
    PendlePtAdapter adapter;
    bool active;

    function setUp() public {
        if (!vm.envOr("RUN_FORK", false)) return;
        string memory rpc = vm.envOr("XLAYER_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        uint24 fee = _discoverFee();
        if (fee == 0) return; // no liquid USDT0/USDG pool on this fork; skip cleanly

        // The PT-USDG market launched hours ago with observation cardinality 1 — it stores only the
        // latest trade, so any TWAP read reverts (OracleTargetTooOld) until the oracle is bootstrapped.
        // Bootstrap it the way mainnet will: raise the buffer so new writes don't evict history, then
        // age the existing observation by warping forward so a point older than the TWAP window exists.
        uint32 twap = 300;
        IPendleMarketCard(MARKET).increaseObservationsCardinalityNext(8);
        vm.warp(block.timestamp + twap + 400); // existing observation is now older than the window
        (,, bool satisfied) = IPtOracleView(PT_ORACLE).getOracleState(MARKET, twap);
        if (!satisfied) return; // oracle still not readable on this fork; skip cleanly

        vm.startPrank(owner);
        pool = new AumoPool(IERC20(USDT0), owner);
        // uniFee, 2% uni floor, 3% pendle floor (thin new market), 50bps NAV discount, 300s TWAP.
        adapter = new PendlePtAdapter(
            USDT0, USDG, MARKET, ROUTER, PT_ORACLE, UNI_ROUTER, address(pool), owner, fee, 200, 300, 50, twap
        );
        pool.setVenueAllowed(address(adapter), true);
        pool.setPolicy(1_000e6, 5_000e6, 10_000e6);
        pool.setLossBudget(500e6, 1 days); // generous churn budget so the legit retreat clears
        pool.setAgent(agent);
        vm.stopPrank();
        active = true;
    }

    function _discoverFee() internal view returns (uint24) {
        uint24[4] memory tiers = [uint24(100), 500, 3000, 10000];
        for (uint256 i; i < tiers.length; ++i) {
            address p = IUniV3Factory(FACTORY).getPool(USDT0, USDG, tiers[i]);
            if (p != address(0) && IUniV3Pool(p).liquidity() > 0) return tiers[i];
        }
        return 0;
    }

    function _fund(uint256 amount) internal {
        deal(USDT0, alice, amount);
        vm.startPrank(alice);
        IERC20(USDT0).approve(address(pool), amount);
        pool.deposit(amount, alice);
        vm.stopPrank();
    }

    function test_pendle_pt_buy_value_and_market_exit_on_real_xlayer() public {
        if (!active) {
            vm.skip(true);
            return;
        }

        uint256 amount = 500e6;
        _fund(amount);
        assertEq(pool.idleBalance(), amount, "pool funded");

        // Agent routes USDT0 -> USDG (Uniswap) -> PT (Pendle).
        vm.prank(agent);
        pool.allocate(address(adapter), amount, "pendle-pt-usdg");
        assertEq(pool.idleBalance(), 0, "idle deployed");

        uint256 pos = pool.venueBalance(address(adapter)); // PT valued by TWAP oracle, ~USDT0 terms
        assertGt(pos, (amount * 95) / 100, "PT position within round-trip cost of principal");

        // Fixed yield realizes as the PT converges to par on the way to maturity.
        vm.warp(block.timestamp + 45 days);
        assertGe(pool.venueBalance(address(adapter)), pos, "position holds or accrues toward par");

        // Full exit BEFORE maturity: PT sold on the market, USDG -> USDT0, back to the pool.
        vm.prank(agent);
        pool.deallocate(address(adapter), type(uint256).max);
        assertEq(pool.allocated(address(adapter)), 0, "principal cleared");
        assertGt(pool.idleBalance(), (amount * 92) / 100, "principal returned minus round-trip cost");
    }

    function test_pendle_pt_redeems_one_to_one_after_maturity() public {
        if (!active) {
            vm.skip(true);
            return;
        }

        uint256 amount = 500e6;
        _fund(amount);
        vm.prank(agent);
        pool.allocate(address(adapter), amount, "pendle-pt-usdg");
        uint256 pos = pool.venueBalance(address(adapter));
        assertGt(pos, (amount * 95) / 100, "position established");

        // Warp past maturity: PT is now redeemable 1:1 for USDG, no market slippage on exit.
        vm.warp(IPendleMarketCard(MARKET).expiry() + 1);

        vm.prank(agent);
        pool.deallocate(address(adapter), type(uint256).max);
        assertEq(pool.allocated(address(adapter)), 0, "principal cleared at maturity");
        // Only the two Uniswap legs cost anything now (no PT market impact), so recovery is tighter.
        assertGt(pool.idleBalance(), (amount * 95) / 100, "near-par redemption at maturity");
    }

    /// @notice Availability hardening: if the PT oracle reverts, balanceOf must NOT revert (which would
    ///         brick the pool's pool-wide totalAssets). It falls open to the last good rate instead.
    function test_pendle_balanceOf_fails_open_when_oracle_reverts() public {
        if (!active) {
            vm.skip(true);
            return;
        }
        uint256 amount = 500e6;
        _fund(amount);
        vm.prank(agent);
        pool.allocate(address(adapter), amount, "pendle-pt-usdg"); // caches lastGoodRate
        uint256 navBefore = pool.venueBalance(address(adapter));
        assertGt(navBefore, 0, "nav established");

        // Force the oracle to revert: demand a TWAP window far longer than the market's history.
        vm.prank(owner);
        adapter.setTwapDuration(3_000_000);

        // The live read now reverts, but balanceOf must still return (using lastGoodRate), so the
        // pool's totalAssets is never bricked by a single venue's oracle hiccup.
        uint256 navAfter = pool.venueBalance(address(adapter));
        assertApproxEqRel(navAfter, navBefore, 0.005e18, "NAV falls open to last good rate, not a revert");
        // And a live deposit/withdraw path that needs the live oracle fails safely (does not corrupt).
        vm.prank(agent);
        vm.expectRevert();
        pool.deallocate(address(adapter), type(uint256).max);
    }
}
