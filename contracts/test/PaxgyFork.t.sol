// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SelfHostedEquityOracle} from "../src/oracles/SelfHostedEquityOracle.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";

interface IQuoterV2 {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (uint256 amountOut, uint160[] memory, uint32[] memory, uint256);
}

interface IAccountant {
    function getRate() external view returns (uint256);
}

/// @notice FORK test against live X Layer. Proves the whole GOLD (PAXGy) path on the REAL Uniswap
///         pools, reusing the hardened EquityAdapter/EquityPool unchanged: deposit USD₮0 -> agent buys
///         PAXGy via USD₮0->USDG->PAXGy (two hops, same shape as the xStock adapters) -> NAV holds ->
///         depositor redeems -> PAXGy sold back -> USD₮0 returned. Also sanity-checks the on-chain
///         Accountant getRate() (the gold-denominated rate the feeder multiplies by gold/USD to post a
///         PAXGY price in production). Run with:
///           forge test --match-contract PaxgyFork --fork-url https://rpc.xlayer.tech -vv
///         Skips itself automatically when not run against a fork (chainid != 196).
contract PaxgyForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    address constant QUOTER = 0xD1b797D92d87B688193A2B976eFc8D577D204343;
    address constant PAXGY = 0x6c6494Fd9962eB98B94ffA48F6679058F820700e; // Paxos yield-bearing gold (18 dec)
    address constant ACCOUNTANT = 0x397e38359f169748a02bc11f98D4f451FE88C1fd; // getRate() (gold terms, WAD)
    uint24 constant FEE_USDT0_USDG = 100; // 0.01%
    uint24 constant FEE_PAXGY_USDG = 500; // 0.05% (the live PAXGy/USDG pool)
    bytes32 constant FEED = bytes32("PAXGY");
    uint32 constant REGULAR = 2;
    uint256 constant MAX_AGE = 300;
    // Wider swap floor for the fork round-trip only (the ~$497K pool has more spread than a deep pair);
    // the production deploy uses the standard 200 bps.
    uint256 constant SLIP = 800;

    SelfHostedEquityOracle oracle;
    EquityPool pool;
    EquityAdapter adapter;
    bytes buyPath;

    address user = address(0xBEEF);

    function setUp() public {
        if (block.chainid != 196) return; // only meaningful on an X Layer fork
        oracle = new SelfHostedEquityOracle(address(this), address(this));
        oracle.registerFeed(FEED, true);
        pool = new EquityPool(IERC20(USDT0), address(this), address(oracle), FEED, MAX_AGE);
        buyPath = abi.encodePacked(USDT0, FEE_USDT0_USDG, USDG, FEE_PAXGY_USDG, PAXGY);
        bytes memory sellPath = abi.encodePacked(PAXGY, FEE_PAXGY_USDG, USDG, FEE_USDT0_USDG, USDT0);
        adapter = new EquityAdapter(
            USDT0, PAXGY, address(oracle), FEED, ROUTER, address(pool), buyPath, sellPath, MAX_AGE, SLIP
        );
        pool.setVenueAllowed(address(adapter), true);
        pool.setPolicy(2_000e6, 1_000_000e6, 1_000_000e6);
        pool.setDeployBudget(1_000_000e6, 1 days);
        pool.setFees(25, 50); // ship with the anti-dilution levy on, same as the equity pools
        pool.setAgent(address(this));
    }

    /// @dev Price the oracle from the live pool quote so the adapter's oracle-derived minOut is
    ///      satisfiable in the test. Production instead posts getRate() x gold/USD via the feeder.
    function _feedPriceFromPool(uint256 amountIn) internal {
        (uint256 paxgyOut,,,) = IQuoterV2(QUOTER).quoteExactInput(buyPath, amountIn);
        require(paxgyOut > 0, "no quote");
        uint256 priceWad = (amountIn * 1e30) / paxgyOut; // USD/PAXGy (WAD) from the live pool
        oracle.submitPrice(FEED, priceWad, REGULAR, uint32(block.timestamp));
    }

    function test_fork_getRate_is_sane() public {
        if (block.chainid != 196) return;
        uint256 rate = IAccountant(ACCOUNTANT).getRate();
        // Gold-denominated rate: ~1.0 PAXGy->oz, a hair above par as yield accrues. Bound loosely.
        assertGt(rate, 1e18, "rate accrues above par");
        assertLt(rate, 12e17, "rate within a sane band (< 1.2)");
        emit log_named_uint("PAXGy getRate() (gold WAD)", rate);
    }

    function test_fork_roundtrip_usdt0_to_paxgy() public {
        if (block.chainid != 196) return;

        uint256 deposit = 2_000e6;
        uint256 alloc = 500e6; // $500 into a ~$497K pool: ~0.1%, low impact
        deal(USDT0, user, deposit);

        _feedPriceFromPool(alloc);
        assertTrue(pool.marketOpen(), "market should read open with a fresh price");

        vm.startPrank(user);
        IERC20(USDT0).approve(address(pool), deposit);
        uint256 shares = pool.deposit(deposit, user);
        vm.stopPrank();
        assertGt(shares, 0, "got pool shares");

        // agent buys PAXGy (two-hop swap on live Uniswap; also proves the freeze-hook allows normal DEX flow)
        pool.allocate(address(adapter), alloc, bytes32("gold"));
        uint256 held = pool.venueBalance(address(adapter));
        assertGt(held, 0, "adapter now holds PAXGy value");
        assertApproxEqRel(pool.totalAssets(), deposit, 0.03e18, "NAV within 3% after buy");

        // depositor exits fully: pool sells PAXGy back to USD₮0 and returns it
        vm.warp(block.timestamp + 60);
        _feedPriceFromPool(alloc);
        vm.prank(user);
        uint256 assetsOut = pool.redeem(shares, user, user);
        assertApproxEqRel(assetsOut, deposit, 0.03e18, "round-trip returns ~deposit (within 3%)");
        assertEq(IERC20(USDT0).balanceOf(user), assetsOut, "user received USDT0");
        // With the anti-dilution levy on, a full redeem leaves a tiny principal sliver (the retained
        // levy) rather than unwinding to exactly 0. It belongs to the pool, benefiting remaining holders.
        assertLt(pool.totalDeployed(), 20e6, "pool unwound to only a small levy residual");
    }
}
