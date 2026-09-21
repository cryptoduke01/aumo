// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEquityOracle} from "./mocks/MockEquityOracle.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";

/// @notice SELF-AUDIT PoC. Demonstrates that on the opt-in EquityPool the "realizable-value redeem"
///         (pay = min(assets, idle)) does NOT achieve its stated invariant — "the exiting holder
///         bears their own exit cost; remaining holders are never charged for it." Because
///         _ensureIdle over-pulls until idle >= assets, a PARTIAL redeemer is paid the FULL marked
///         NAV while the routine exit-swap slippage is socialized to the holders who stay.
///
///         Model: NAV is marked at the ORACLE price (100). The execution venue (router) fills the
///         SELL at a slightly worse price (99, i.e. 1% exit slippage) — exactly what a real
///         xStock->USDG->USDT0 round trip costs. Oracle stays fresh, so no market-hours gate and no
///         staleness revert; this is a clean, healthy day, not a depeg.
contract SelfAuditExitSlippageTest is Test {
    MockERC20 usdt0;
    MockERC20 stock;
    MockEquityOracle oracle;
    MockSwapRouter router;
    EquityAdapter adapter;
    EquityPool pool;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    bytes32 constant FEED = bytes32("NVDA");
    uint256 constant ORACLE_PX = 100e18; // NAV marks here
    uint256 constant EXEC_PX = 99e18; // venue fills the sell 1% worse (realistic exit slippage)
    uint256 constant MAX_AGE = 1 hours;
    uint256 constant SLIP = 200; // 2% adapter slippage bound (1% actual is within it)
    uint256 constant DEP = 1_000e6;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdt0 = new MockERC20("USD0", "USD0", 6);
        stock = new MockERC20("NVDAx", "NVDAx", 18);
        oracle = new MockEquityOracle();
        oracle.set(FEED, ORACLE_PX, block.timestamp);

        // Router starts at oracle price so the agent's BUY is clean (isolates the exit leg).
        router = new MockSwapRouter(address(usdt0), address(stock), 6, 18, ORACLE_PX);
        usdt0.mint(address(router), 10_000_000e6);
        stock.mint(address(router), 10_000_000e18);

        pool = new EquityPool(IERC20(address(usdt0)), address(this), address(oracle), FEED, MAX_AGE);
        adapter = new EquityAdapter(
            address(usdt0),
            address(stock),
            address(oracle),
            FEED,
            address(router),
            address(pool),
            abi.encodePacked(address(usdt0), uint24(3000), address(stock)),
            abi.encodePacked(address(stock), uint24(3000), address(usdt0)),
            MAX_AGE,
            SLIP
        );
        pool.setVenueAllowed(address(adapter), true);
        pool.setPolicy(10_000e6, 1_000_000e6, 1_000_000e6);
        pool.setDeployBudget(1_000_000e6, 1 days);

        usdt0.mint(alice, DEP);
        usdt0.mint(bob, DEP);
        vm.prank(alice);
        usdt0.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        usdt0.approve(address(pool), type(uint256).max);
    }

    function test_partial_redeemer_is_overpaid_stayers_eat_the_slippage() public {
        // Two equal depositors.
        vm.prank(alice);
        uint256 aShares = pool.deposit(DEP, alice);
        vm.prank(bob);
        uint256 bShares = pool.deposit(DEP, bob);

        // Agent deploys the whole 2,000 into the stock at the oracle price (clean entry).
        pool.allocate(address(adapter), 2 * DEP, bytes32("buy"));
        assertApproxEqAbs(pool.totalAssets(), 2 * DEP, 3, "NAV ~ 2000 after buy");
        assertEq(pool.idleBalance(), 0, "fully deployed");

        // A normal trading day: NAV still marks at oracle 100, but the venue now fills sells 1% worse.
        router.setPrice(EXEC_PX);
        oracle.set(FEED, ORACLE_PX, block.timestamp); // keep the clock fresh (market open)

        // Fair benchmark: if Alice bore her OWN exit slippage she would realize ~1% below her marked
        // half, i.e. ~990. The marked value of her half is ~1000.
        uint256 aliceMarked = pool.convertToAssets(aShares);

        uint256 beforeA = usdt0.balanceOf(alice);
        vm.prank(alice);
        uint256 alicePaid = pool.redeem(aShares, alice, alice);
        assertEq(usdt0.balanceOf(alice) - beforeA, alicePaid, "paid == reported");

        // 1) Alice is paid the FULL marked NAV of her shares — she bore ~none of her exit slippage.
        assertApproxEqAbs(alicePaid, aliceMarked, 1e6, "Alice paid full marked NAV, not realizable");
        assertGe(alicePaid, aliceMarked - 1, "Alice not shortchanged");

        // 2) Bob (the stayer) now holds ALL remaining shares. His redeemable value has dropped BELOW
        //    his fair marked half (~1000): he has been charged Alice's exit slippage.
        uint256 bobValueAfter = pool.convertToAssets(bShares);
        emit log_named_uint("alice marked (fair-if-she-bore-cost ~990)", aliceMarked);
        emit log_named_uint("alice actually paid", alicePaid);
        emit log_named_uint("bob redeemable AFTER alice exit (fair ~1000)", bobValueAfter);

        assertLt(bobValueAfter, DEP - 1e6, "Bob's NAV fell >0.1% purely from Alice's exit");

        // 3) Quantify the transfer: Bob's loss ~ the slippage Alice avoided (~1% of 1000 ~= 10 USDT0).
        uint256 bobLoss = DEP - bobValueAfter;
        emit log_named_uint("bob loss (USDT0, 6dp)", bobLoss);
        assertGt(bobLoss, 5e6, "Bob lost >5 USDT0 he should not have");
    }

    /// @dev First-depositor / donation-inflation check on a FRESH (empty) EquityPool — the exact
    ///      state the launch basket is in. With _decimalsOffset() == 6 the classic inflation attack
    ///      cannot grief the next depositor: the attacker seeds 1 unit, donates a large amount
    ///      directly, yet the victim still redeems ~their full deposit (not rounded to dust), and the
    ///      attacker eats the donation. Confirms the mitigation holds for the empty basket.
    function test_first_depositor_donation_does_not_grief_victim() public {
        // Attacker seeds the empty pool with 1 unit and gets the virtual-share-scaled amount.
        vm.prank(alice);
        uint256 aShares = pool.deposit(1, alice);
        assertGt(aShares, 0, "seed minted");

        // Attacker donates 500 USDT0 directly into the pool to try to inflate the share price.
        vm.prank(alice);
        usdt0.transfer(address(pool), 500e6);

        // Victim deposits 100 USDT0.
        usdt0.mint(bob, 100e6);
        vm.prank(bob);
        usdt0.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        uint256 bShares = pool.deposit(100e6, bob);
        assertGt(bShares, 0, "victim still gets shares, not zero (no inflation grief)");

        // Victim can redeem ~their full 100 USDT0 back — the donation did not steal from them.
        uint256 bobRedeemable = pool.convertToAssets(bShares);
        emit log_named_uint("victim redeemable vs 100e6 deposit", bobRedeemable);
        assertApproxEqRel(bobRedeemable, 100e6, 0.01e18, "victim keeps ~full deposit; attack fails");
    }

    /// @dev Control: a SOLE holder redeeming everything triggers the full-position drain (max
    ///      sentinel), idle lands below marked, pay = idle, so the sole exiter DOES bear their own
    ///      slippage. This is why the bug only bites when OTHER holders remain to absorb it.
    function test_sole_holder_bears_own_slippage() public {
        vm.prank(alice);
        uint256 aShares = pool.deposit(DEP, alice);
        pool.allocate(address(adapter), DEP, bytes32("buy"));

        router.setPrice(EXEC_PX);
        oracle.set(FEED, ORACLE_PX, block.timestamp);

        uint256 marked = pool.convertToAssets(aShares);
        vm.prank(alice);
        uint256 paid = pool.redeem(aShares, alice, alice);
        emit log_named_uint("sole holder marked", marked);
        emit log_named_uint("sole holder paid", paid);
        assertLt(paid, marked, "sole holder bears their own exit slippage (pay = idle < marked)");
    }
}
