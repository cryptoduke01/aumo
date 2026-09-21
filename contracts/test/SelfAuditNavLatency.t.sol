// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEquityOracle} from "./mocks/MockEquityOracle.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";

/// @notice SELF-AUDIT PoC (F-NAV-LATENCY). Entry/exit on the EquityPool price off the ORACLE mark.
///         The off-chain feeder stamps its on-chain observation timestamp with FETCH TIME
///         (Date.now()), not the market observation time, so the on-chain freshness guard
///         (marketMaxAge / adapter maxAge) tracks "is the feeder process alive", NOT "is this price
///         recent". While the feeder is alive but its PRICE lags the real market (a fast move within
///         a feeder cycle, or a feeder that keeps posting a stale price during a lag/gap), the mark is
///         stale-yet-fresh-stamped and marketOpen() stays true.
///
///         This lets an UNPRIVILEGED actor who sees the real price ahead of the mark deposit at the
///         stale-low NAV and, once the feeder catches up, redeem at the corrected value — skimming
///         the correction from the passive holders. The market-hours gate, the monotonic guard, the
///         realizable-value redeem, and the 20% deviation breaker do NOT prevent it.
///
///         Model (pure mocks, deterministic): NAV marks at the ORACLE price; the execution venue
///         (router) fills at the REAL price. A +5% real move is arbed into the DEX immediately
///         (router.setPrice) while the oracle keeps posting the old price with a FRESH timestamp
///         (feeder alive, price lagging). 5% < the 20% breaker, so nothing reverts.
contract SelfAuditNavLatencyTest is Test {
    MockERC20 usdt0;
    MockERC20 stock;
    MockEquityOracle oracle;
    MockSwapRouter router;
    EquityAdapter adapter;
    EquityPool pool;

    address alice = address(0xA11CE); // passive holder
    address bob = address(0xB0B); // unprivileged latency arber

    bytes32 constant FEED = bytes32("NVDA");
    uint256 constant P0 = 100e18; // last mark the (alive) feeder is still posting
    uint256 constant P1 = 105e18; // real price now (arbed into the DEX); +5% within the 20% breaker
    uint256 constant MAX_AGE = 1 hours;
    uint256 constant SLIP = 200; // 2% adapter bound, matching the live deploy
    uint256 constant DEP = 1_000e6;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdt0 = new MockERC20("USD0", "USD0", 6);
        stock = new MockERC20("NVDAx", "NVDAx", 18);
        oracle = new MockEquityOracle();
        oracle.set(FEED, P0, block.timestamp);

        router = new MockSwapRouter(address(usdt0), address(stock), 6, 18, P0);
        usdt0.mint(address(router), 100_000_000e6);
        stock.mint(address(router), 100_000_000e18);

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
        pool.setPolicy(1_000_000e6, 1_000_000e6, 1_000_000e6);
        pool.setDeployBudget(1_000_000e6, 1 days);

        usdt0.mint(alice, DEP);
        usdt0.mint(bob, DEP);
        vm.prank(alice);
        usdt0.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        usdt0.approve(address(pool), type(uint256).max);
    }

    function test_stale_mark_lets_late_depositor_skim_passive_holders() public {
        // 1) Passive holder Alice is fully invested at the fair price P0.
        vm.prank(alice);
        uint256 aShares = pool.deposit(DEP, alice);
        pool.allocate(address(adapter), DEP, bytes32("buy")); // agent buys the stock at P0
        assertEq(pool.idleBalance(), 0, "Alice fully deployed");

        // 2) Real price jumps +5%. The DEX arbs to P1 at once; the feeder is ALIVE but still posting
        //    the old P0 with a FRESH timestamp (fetch-time stamping => on-chain looks fresh).
        router.setPrice(P1);
        oracle.set(FEED, P0, block.timestamp); // stale PRICE, fresh CLOCK
        assertTrue(pool.marketOpen(), "market reads OPEN on the fresh-stamped but stale price");

        // 3) Bob (no privilege) deposits at the stale-low NAV. He mints against a pool whose stock is
        //    marked at P0 but is really worth P1 -> he buys in cheap. His cash is left idle (his gain
        //    does not depend on redeploying it).
        vm.prank(bob);
        uint256 bShares = pool.deposit(DEP, bob);

        // 4) Feeder catches up to the real price. 5% < 20% breaker, monotonic ts satisfied -> accepted.
        vm.warp(block.timestamp + 30);
        oracle.set(FEED, P1, block.timestamp);

        // Alice's RIGHTFUL value at the corrected price, had Bob never deposited: she funded 100% of
        // the stock, now worth P1. This is the honest counterfactual baseline (~1050).
        uint256 aliceRightfulAtP1 = pool.venueBalance(address(adapter));

        // 5) Bob redeems. The top-up sell fills at the (now-consistent) P1, within the 2% bound.
        uint256 bobBefore = usdt0.balanceOf(bob);
        vm.prank(bob);
        uint256 bobPaid = pool.redeem(bShares, bob, bob);
        assertEq(usdt0.balanceOf(bob) - bobBefore, bobPaid, "paid == reported");

        uint256 aliceFairAfter = pool.convertToAssets(aShares);

        emit log_named_uint("Bob deposited            ", DEP);
        emit log_named_uint("Bob redeemed (out)       ", bobPaid);
        emit log_named_uint("Alice rightful @P1 (solo)", aliceRightfulAtP1);
        emit log_named_uint("Alice actual after Bob   ", aliceFairAfter);

        // Bob turned a risk-free profit purely from the mark lag ...
        assertGt(bobPaid, DEP + 5e6, "Bob skims >0.5% risk-free from the stale mark");
        // ... paid for by the passive holder, whose corrected value is skimmed below her rightful P1.
        assertLt(aliceFairAfter, aliceRightfulAtP1, "Alice diluted below her rightful post-move value");
        emit log_named_uint("value transferred A->B   ", bobPaid - DEP);
        emit log_named_uint("Alice loss vs rightful   ", aliceRightfulAtP1 - aliceFairAfter);
    }

    /// @dev Control: with NO mark lag (oracle == DEX throughout), the same deposit/redeem round-trip
    ///      is NOT profitable — Bob gets back ~his deposit minus swap costs. Isolates the lag as the
    ///      sole source of the skim above.
    function test_control_no_lag_no_profit() public {
        vm.prank(alice);
        uint256 aShares = pool.deposit(DEP, alice);
        pool.allocate(address(adapter), DEP, bytes32("buy"));
        aShares; // silence

        // price moves, but the oracle and the DEX move TOGETHER (no lag).
        router.setPrice(P1);
        oracle.set(FEED, P1, block.timestamp);

        vm.prank(bob);
        uint256 bShares = pool.deposit(DEP, bob);
        vm.prank(bob);
        uint256 bobPaid = pool.redeem(bShares, bob, bob);
        emit log_named_uint("Bob out (no-lag control)", bobPaid);
        assertLe(bobPaid, DEP, "no lag => no free profit (<= deposit)");
    }
}
