// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEquityOracle} from "./mocks/MockEquityOracle.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";

/// @notice Unit suite for the directional equity adapter. This test contract plays the role of the
///         opt-in equity vault (it is the adapter's `vault`), so it can drive deposit/withdraw.
contract EquityAdapterTest is Test {
    MockERC20 usdt0;
    MockERC20 stock;
    MockEquityOracle oracle;
    MockSwapRouter router;
    EquityAdapter adapter;

    bytes32 constant FEED = bytes32("NVDA");
    uint256 constant PX = 100e18; // $100 / share
    uint256 constant AMOUNT = 1_000e6; // 1,000 USD₮0
    uint256 constant MAX_AGE = 1 hours;
    uint256 constant SLIP = 200; // 2%

    function setUp() public {
        vm.warp(1_800_000_000); // stable base time so staleness math never underflows

        usdt0 = new MockERC20("USD0", "USD0", 6);
        stock = new MockERC20("NVDAx", "NVDAx", 18);
        oracle = new MockEquityOracle();
        oracle.set(FEED, PX, block.timestamp);

        router = new MockSwapRouter(address(usdt0), address(stock), 6, 18, PX);
        usdt0.mint(address(router), 1_000_000e6);
        stock.mint(address(router), 1_000_000e18);

        adapter = new EquityAdapter(
            address(usdt0), address(stock), address(oracle), FEED, address(router), address(this), 3000, MAX_AGE, SLIP
        );

        usdt0.mint(address(this), 10_000e6);
        usdt0.approve(address(adapter), type(uint256).max);
    }

    function test_deposit_buys_stock_at_oracle_price() public {
        assertEq(adapter.deposit(AMOUNT), AMOUNT, "supplied == amount");
        assertEq(stock.balanceOf(address(adapter)), 10e18, "1000 USD0 buys 10 shares @ $100");
        assertEq(adapter.balanceOf(address(0)), AMOUNT, "NAV == amount at flat price");
    }

    function test_nav_tracks_price_both_ways() public {
        adapter.deposit(AMOUNT);
        oracle.set(FEED, 110e18, block.timestamp);
        assertEq(adapter.balanceOf(address(0)), 1_100e6, "NAV up with the stock");
        oracle.set(FEED, 90e18, block.timestamp);
        assertEq(adapter.balanceOf(address(0)), 900e6, "NAV down with the stock");
    }

    function test_stale_price_refuses_to_trade() public {
        oracle.set(FEED, PX, block.timestamp - MAX_AGE - 1); // market closed
        vm.expectRevert(EquityAdapter.StalePrice.selector);
        adapter.deposit(AMOUNT);
    }

    function test_zero_price_refuses() public {
        oracle.set(FEED, 0, block.timestamp);
        vm.expectRevert(EquityAdapter.ZeroPrice.selector);
        adapter.deposit(AMOUNT);
    }

    function test_slippage_guard_refuses_bad_fill() public {
        router.setPrice(103e18); // pool 3% worse than the oracle, beyond the 2% bound
        vm.expectRevert(bytes("Too little received"));
        adapter.deposit(AMOUNT);
    }

    function test_withdraw_returns_usdt0_to_vault() public {
        adapter.deposit(AMOUNT);
        uint256 before = usdt0.balanceOf(address(this));
        uint256 out = adapter.withdraw(AMOUNT);
        assertApproxEqAbs(out, AMOUNT, 2, "withdraw returns ~amount at flat price");
        assertApproxEqAbs(usdt0.balanceOf(address(this)) - before, AMOUNT, 2, "vault received it");
    }

    function test_full_exit_clears_position() public {
        adapter.deposit(AMOUNT);
        adapter.withdraw(type(uint256).max);
        assertEq(stock.balanceOf(address(adapter)), 0, "all stock sold");
        assertEq(adapter.balanceOf(address(0)), 0, "NAV zero");
    }

    function test_only_vault_can_move_funds() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(EquityAdapter.OnlyVault.selector);
        adapter.deposit(AMOUNT);

        vm.prank(address(0xBEEF));
        vm.expectRevert(EquityAdapter.OnlyVault.selector);
        adapter.withdraw(AMOUNT);
    }

    function test_constructor_rejects_bad_config() public {
        vm.expectRevert(EquityAdapter.BadConfig.selector); // slippage >= 100%
        new EquityAdapter(
            address(usdt0), address(stock), address(oracle), FEED, address(router), address(this), 3000, MAX_AGE, 10_000
        );
        vm.expectRevert(EquityAdapter.BadConfig.selector); // maxAge 0
        new EquityAdapter(
            address(usdt0), address(stock), address(oracle), FEED, address(router), address(this), 3000, 0, SLIP
        );
        vm.expectRevert(EquityAdapter.BadConfig.selector); // zero vault
        new EquityAdapter(
            address(usdt0), address(stock), address(oracle), FEED, address(router), address(0), 3000, MAX_AGE, SLIP
        );
    }
}
