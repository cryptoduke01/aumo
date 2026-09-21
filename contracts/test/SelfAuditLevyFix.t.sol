// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockEquityOracle} from "./mocks/MockEquityOracle.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";

/// @notice FIX PROOF for the self-audit Mediums. Same mock rig as SelfAuditExitSlippage /
///         SelfAuditNavLatency, but with the anti-dilution levy (AumoPool.setFees) enabled. The levy
///         is RETAINED BY THE POOL, so a joining/leaving holder pays for the value their action moves
///         and the holders who stay are made whole. This turns both proven Mediums non-exploitable:
///           - exit-slippage socialization: an exiting holder now bears their own exit cost;
///           - routine NAV-latency skim: a deposit-then-redeem round trip inside a normal feeder cycle
///             is no longer risk-free.
///         Also proves the future-dated-observation panic clamp on the adapter (F-6).
contract SelfAuditLevyFixTest is Test {
    MockERC20 usdt0;
    MockERC20 stock;
    MockEquityOracle oracle;
    MockSwapRouter router;
    EquityAdapter adapter;
    EquityPool pool;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    bytes32 constant FEED = bytes32("NVDA");
    uint256 constant MAX_AGE = 1 hours;
    uint256 constant SLIP = 200; // 2% adapter bound, matching the live deploy
    uint256 constant DEP = 1_000e6;

    uint256 constant PX0 = 100e18; // oracle mark all three tests start from

    function setUp() public {
        vm.warp(1_800_000_000);
        usdt0 = new MockERC20("USD0", "USD0", 6);
        stock = new MockERC20("NVDAx", "NVDAx", 18);
        oracle = new MockEquityOracle();
        oracle.set(FEED, PX0, block.timestamp);

        router = new MockSwapRouter(address(usdt0), address(stock), 6, 18, PX0);
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

    /// @dev The exact scenario SelfAuditExitSlippage broke: 1% exit slippage, two equal holders, one
    ///      partial exit. With the exit levy set at/above the modeled slippage, the stayer is no longer
    ///      charged for the exiter's swap cost — his NAV-per-share holds up or improves.
    function test_levy_kills_exit_slippage_socialization() public {
        pool.setFees(0, 120); // 1.2% exit levy, above the 1% modeled exit slippage

        vm.prank(alice);
        uint256 aShares = pool.deposit(DEP, alice);
        vm.prank(bob);
        uint256 bShares = pool.deposit(DEP, bob);
        pool.allocate(address(adapter), 2 * DEP, bytes32("buy"));

        // Normal day: NAV marks at oracle 100, venue fills sells 1% worse.
        router.setPrice(99e18);
        oracle.set(FEED, 100e18, block.timestamp);

        uint256 aliceMarked = pool.convertToAssets(aShares);
        vm.prank(alice);
        uint256 alicePaid = pool.redeem(aShares, alice, alice);

        uint256 bobValueAfter = pool.convertToAssets(bShares);
        emit log_named_uint("alice marked", aliceMarked);
        emit log_named_uint("alice paid (bears own exit cost)", alicePaid);
        emit log_named_uint("bob value after alice exit", bobValueAfter);

        // Alice bears her own exit cost: she is paid less than her full marked NAV.
        assertLt(alicePaid, aliceMarked, "exiter now bears her own slippage via the levy");
        // The stayer is NOT charged: his NAV-per-share held up (fair ~1000), unlike the vuln PoC where
        // it fell >0.5%. Allow a small virtual-share/rounding tolerance.
        assertGe(bobValueAfter, DEP - 1e6, "stayer no longer eats the exiter's slippage");
    }

    /// @dev The NAV-latency skim on a REALISTIC intra-cycle move (+0.4%, the kind of gap a 60s feeder
    ///      can carry between ticks). With the round-trip levy the deposit-then-redeem is no longer
    ///      risk-free: Bob gets back at most his deposit. (A 5%-in-60s gap is out of the levy's scope
    ///      and is bounded instead by the tighter staleness window + deviation breaker + feed cadence.)
    function test_levy_kills_routine_latency_skim() public {
        pool.setFees(25, 50); // 0.25% entry + 0.5% exit levy, round-trip 0.75% > the 0.4% move

        vm.prank(alice);
        uint256 aShares = pool.deposit(DEP, alice);
        pool.allocate(address(adapter), DEP, bytes32("buy"));

        // Real price ticks +0.4%; DEX arbs instantly, feeder still posts the old mark with a fresh clock.
        router.setPrice(1004e17); // 100.4
        oracle.set(FEED, 100e18, block.timestamp);
        assertTrue(pool.marketOpen(), "market still reads open");

        vm.prank(bob);
        uint256 bShares = pool.deposit(DEP, bob);

        // Feeder catches up.
        vm.warp(block.timestamp + 30);
        oracle.set(FEED, 1004e17, block.timestamp);

        vm.prank(bob);
        uint256 bobPaid = pool.redeem(bShares, bob, bob);
        emit log_named_uint("bob deposited", DEP);
        emit log_named_uint("bob redeemed", bobPaid);
        assertLe(bobPaid, DEP, "round-trip levy removes the risk-free skim");

        // And the passive holder is not diluted below a plain +0.4% gain on her stake.
        assertGe(pool.convertToAssets(aShares), DEP, "passive holder keeps at least her principal");
    }

    /// @dev F-6: a future-dated observation (within the oracle's 300s skew) must not panic-revert the
    ///      trade path. Before the clamp, `block.timestamp - updatedAt` underflowed (panic 0x11).
    function test_future_dated_observation_does_not_panic() public {
        vm.prank(alice);
        pool.deposit(DEP, alice);

        // Oracle stamped 100s in the future (feeder clock skew, allowed by MAX_FUTURE_SKEW=300).
        oracle.set(FEED, 100e18, block.timestamp + 100);

        // Allocate reaches EquityAdapter._freshPriceWad; it must treat the future stamp as fresh, not
        // underflow-panic. (No expectRevert: the call should simply succeed.)
        pool.allocate(address(adapter), DEP, bytes32("buy"));
        assertGt(pool.venueBalance(address(adapter)), 0, "bought without panic on a future-dated mark");
    }
}
