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

/// @notice FORK test of the DIVERSIFIED BASKET on live X Layer. Proves ONE EquityPool holding four
///         stocks through four adapters: deposit USD₮0 -> agent buys an EQUAL-WEIGHT basket across
///         wNVDAx/wAAPLx/wMSFTx/wMETAx -> NAV holds -> depositor redeems -> the pool sweeps ALL FOUR
///         venues back to USD₮0. Run with:
///           forge test --match-contract BasketFork --fork-url https://rpc.xlayer.tech -vv
///         Skips itself when not on an X Layer fork (chainid != 196).
contract BasketForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    address constant QUOTER = 0xD1b797D92d87B688193A2B976eFc8D577D204343;
    uint24 constant FEE1 = 100;
    uint24 constant FEE2 = 500;
    uint32 constant REGULAR = 2;
    uint256 constant MAX_AGE = 1 hours;

    SelfHostedEquityOracle oracle;
    EquityPool pool;
    EquityAdapter[4] adapters;
    bytes32[4] feeds = [bytes32("NVDA"), bytes32("AAPL"), bytes32("MSFT"), bytes32("META")];
    address[4] wtokens = [
        0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5,
        0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f,
        0x166Fbe68274b6a47e025F4ba17388c539f1fa1d0,
        0xe840946FfEBCd66B7C4E95095effaFaDfa0D0e56
    ];
    bytes[4] buyPaths;

    address user = address(0xBEEF);

    function setUp() public {
        if (block.chainid != 196) return;
        oracle = new SelfHostedEquityOracle(address(this), address(this));
        pool = new EquityPool(IERC20(USDT0), address(this), address(oracle), bytes32("NVDA"), MAX_AGE);
        for (uint256 i; i < 4; ++i) {
            oracle.registerFeed(feeds[i], true);
            buyPaths[i] = abi.encodePacked(USDT0, FEE1, USDG, FEE2, wtokens[i]);
            bytes memory sellPath = abi.encodePacked(wtokens[i], FEE2, USDG, FEE1, USDT0);
            adapters[i] = new EquityAdapter(
                USDT0, wtokens[i], address(oracle), feeds[i], ROUTER, address(pool), buyPaths[i], sellPath, MAX_AGE, 800
            );
            pool.setVenueAllowed(address(adapters[i]), true);
        }
        pool.setPolicy(2_000e6, 1_000_000e6, 1_000_000e6);
        pool.setDeployBudget(1_000_000e6, 1 days);
        pool.setAgent(address(this));
    }

    function _feed(uint256 i, uint256 amountIn) internal {
        (uint256 out,,,) = IQuoterV2(QUOTER).quoteExactInput(buyPaths[i], amountIn);
        require(out > 0, "no quote");
        oracle.submitPrice(feeds[i], (amountIn * 1e30) / out, REGULAR, uint32(block.timestamp));
    }

    function test_fork_equal_weight_basket_roundtrip() public {
        if (block.chainid != 196) return;

        uint256 deposit = 2_000e6;
        uint256 allocEach = 480e6; // ~equal weight across 4 (1_920 deployed, ~80 idle)
        deal(USDT0, user, deposit);

        for (uint256 i; i < 4; ++i) _feed(i, allocEach);
        assertTrue(pool.marketOpen(), "market open with fresh clock");

        vm.startPrank(user);
        IERC20(USDT0).approve(address(pool), deposit);
        uint256 shares = pool.deposit(deposit, user);
        vm.stopPrank();
        assertGt(shares, 0, "got shares");

        // agent builds the equal-weight basket: buy each stock in turn
        for (uint256 i; i < 4; ++i) {
            pool.allocate(address(adapters[i]), allocEach, bytes32("basket-buy"));
            assertGt(pool.venueBalance(address(adapters[i])), 0, "venue holds stock value");
        }
        assertApproxEqRel(pool.totalAssets(), deposit, 0.04e18, "NAV within 4% after 4 buys");

        // full redemption sweeps ALL FOUR venues back to USD₮0
        vm.warp(block.timestamp + 60);
        for (uint256 i; i < 4; ++i) _feed(i, allocEach);
        vm.prank(user);
        uint256 out = pool.redeem(shares, user, user);
        assertApproxEqRel(out, deposit, 0.05e18, "basket round-trip returns ~deposit (within 5%)");
        assertEq(IERC20(USDT0).balanceOf(user), out, "user received USDT0");
        assertEq(pool.totalDeployed(), 0, "basket fully unwound across all venues");
    }
}
