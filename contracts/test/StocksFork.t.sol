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

/// @notice FORK test against live X Layer. Proves the whole Stocks path on the REAL Uniswap pools:
///         deposit USD₮0 -> agent buys wNVDAx via USD₮0->USDG->wNVDAx (two hops) -> NAV holds ->
///         depositor redeems -> position sold back -> USD₮0 returned. Run with:
///           forge test --match-contract StocksFork --fork-url https://rpc.xlayer.tech -vv
///         Skips itself automatically when not run against a fork (chainid != 196).
contract StocksForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    address constant QUOTER = 0xD1b797D92d87B688193A2B976eFc8D577D204343;
    address constant WNVDA = 0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5;
    uint24 constant FEE1 = 100;
    uint24 constant FEE2 = 500;
    bytes32 constant FEED = bytes32("NVDA");
    uint32 constant REGULAR = 2;
    uint256 constant MAX_AGE = 1 hours;

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
        buyPath = abi.encodePacked(USDT0, FEE1, USDG, FEE2, WNVDA);
        bytes memory sellPath = abi.encodePacked(WNVDA, FEE2, USDG, FEE1, USDT0);
        adapter = new EquityAdapter(
            USDT0, WNVDA, address(oracle), FEED, ROUTER, address(pool), buyPath, sellPath, MAX_AGE, 800
        );
        pool.setVenueAllowed(address(adapter), true);
        pool.setPolicy(2_000e6, 1_000_000e6, 1_000_000e6);
        pool.setDeployBudget(1_000_000e6, 1 days);
        pool.setAgent(address(this));
    }

    function _feedPriceFromPool(uint256 amountIn) internal {
        (uint256 sharesOut,,,) = IQuoterV2(QUOTER).quoteExactInput(buyPath, amountIn);
        require(sharesOut > 0, "no quote");
        uint256 priceWad = (amountIn * 1e30) / sharesOut; // USD/share (WAD), from the live pool
        oracle.submitPrice(FEED, priceWad, REGULAR, uint32(block.timestamp));
    }

    function test_fork_roundtrip_usdt0_to_wnvdax() public {
        if (block.chainid != 196) return;

        uint256 deposit = 2_000e6;
        uint256 alloc = 500e6;
        deal(USDT0, user, deposit);

        // price the oracle from the real pool so the adapter's oracle-derived minOut is satisfiable
        _feedPriceFromPool(alloc);
        assertTrue(pool.marketOpen(), "market should read open with a fresh price");

        // deposit
        vm.startPrank(user);
        IERC20(USDT0).approve(address(pool), deposit);
        uint256 shares = pool.deposit(deposit, user);
        vm.stopPrank();
        assertGt(shares, 0, "got pool shares");
        assertEq(pool.totalAssets(), deposit, "assets == deposit before allocate");

        // agent buys the stock (two-hop swap on live Uniswap)
        pool.allocate(address(adapter), alloc, bytes32("buy"));
        uint256 held = pool.venueBalance(address(adapter));
        assertGt(held, 0, "adapter now holds wNVDAx value");
        // NAV is roughly conserved across the swap (fees + spread only)
        uint256 navAfterBuy = pool.totalAssets();
        assertApproxEqRel(navAfterBuy, deposit, 0.03e18, "NAV within 3% after buy");

        // depositor exits fully: pool pulls from the adapter (sell back to USD₮0) + returns idle
        vm.warp(block.timestamp + 60); // advance so the monotonic oracle accepts a fresh observation
        _feedPriceFromPool(alloc); // refresh price for the exit
        vm.prank(user);
        uint256 assetsOut = pool.redeem(shares, user, user);
        assertApproxEqRel(assetsOut, deposit, 0.03e18, "round-trip returns ~deposit (within 3%)");
        assertEq(IERC20(USDT0).balanceOf(user), assetsOut, "user received USDT0");
        assertEq(pool.totalDeployed(), 0, "pool fully unwound");
    }
}
