// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVenueAdapter} from "./mocks/MockVenueAdapter.sol";

/// @dev Drives the pool with random, bounded action sequences (deposit / withdraw / redeem across
///      several actors; agent allocate / deallocate across venues; simulated venue yield). The
///      invariants below assert the properties the product promises hold no matter the ordering.
contract Handler is Test {
    AumoPool public pool;
    MockERC20 public usdt0;
    MockVenueAdapter[] public venues;
    address public agent;
    address[] public actors;
    uint256 public ghostYield; // total simulated yield injected into venues

    constructor(
        AumoPool _pool,
        MockERC20 _usdt0,
        MockVenueAdapter[] memory _venues,
        address _agent,
        address[] memory _actors
    ) {
        pool = _pool;
        usdt0 = _usdt0;
        agent = _agent;
        for (uint256 i; i < _venues.length; i++) venues.push(_venues[i]);
        for (uint256 i; i < _actors.length; i++) actors.push(_actors[i]);
    }

    function deposit(uint256 actorSeed, uint256 amount) public {
        address a = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 1000e6);
        usdt0.mint(a, amount);
        vm.startPrank(a);
        usdt0.approve(address(pool), amount);
        pool.deposit(amount, a);
        vm.stopPrank();
    }

    function withdraw(uint256 actorSeed, uint256 amount) public {
        address a = actors[actorSeed % actors.length];
        uint256 mx = pool.maxWithdraw(a);
        if (mx == 0) return;
        amount = bound(amount, 1, mx);
        vm.prank(a);
        pool.withdraw(amount, a, a);
    }

    function redeem(uint256 actorSeed, uint256 shares) public {
        address a = actors[actorSeed % actors.length];
        uint256 bal = pool.balanceOf(a);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        vm.prank(a);
        pool.redeem(shares, a, a);
    }

    function allocate(uint256 vSeed, uint256 amount) public {
        MockVenueAdapter v = venues[vSeed % venues.length];
        uint256 idle = pool.idleBalance();
        if (idle == 0) return;
        amount = bound(amount, 1, idle);
        // May revert on a cap/budget; that's the guardrail doing its job, so swallow and move on.
        vm.prank(agent);
        try pool.allocate(address(v), amount, bytes32("inv")) {} catch {}
    }

    function deallocate(uint256 vSeed, uint256 amount) public {
        MockVenueAdapter v = venues[vSeed % venues.length];
        uint256 alloc = pool.allocated(address(v));
        if (alloc == 0) return;
        amount = bound(amount, 1, alloc);
        vm.prank(agent);
        try pool.deallocate(address(v), amount) {} catch {}
    }

    function accrue(uint256 vSeed, uint256 amount) public {
        MockVenueAdapter v = venues[vSeed % venues.length];
        if (pool.allocated(address(v)) == 0) return;
        amount = bound(amount, 1, 50e6);
        usdt0.mint(address(v), amount); // fund the venue so the yield can actually be withdrawn
        v.accrue(address(pool), amount);
        ghostYield += amount;
    }
}

contract AumoPoolInvariantTest is Test {
    AumoPool pool;
    MockERC20 usdt0;
    MockVenueAdapter[] venues;
    Handler handler;
    address agent = address(0xA9E17);
    address[3] actorList = [address(0xA11CE), address(0xB0B), address(0xCA11)];
    uint256 constant U = 1e6;

    function setUp() public {
        usdt0 = new MockERC20("USDT0", "USDT0", 6);
        pool = new AumoPool(IERC20(address(usdt0)), address(this));
        MockVenueAdapter v0 = new MockVenueAdapter(address(usdt0));
        MockVenueAdapter v1 = new MockVenueAdapter(address(usdt0));
        venues.push(v0);
        venues.push(v1);
        pool.setAgent(agent);
        pool.setVenueAllowed(address(v0), true);
        pool.setVenueAllowed(address(v1), true);
        pool.setPolicy(200 * U, 500 * U, 800 * U); // maxMove, perVenueCap, totalCap

        MockVenueAdapter[] memory vs = new MockVenueAdapter[](2);
        vs[0] = v0;
        vs[1] = v1;
        address[] memory actors = new address[](3);
        for (uint256 i; i < 3; i++) actors[i] = actorList[i];

        handler = new Handler(pool, usdt0, vs, agent, actors);
        targetContract(address(handler));
    }

    /// Principal in any single venue never exceeds the per-venue cap.
    function invariant_perVenueCapNeverExceeded() public view {
        uint256 cap = pool.perVenueCap();
        for (uint256 i; i < venues.length; i++) {
            assertLe(pool.allocated(address(venues[i])), cap, "per-venue principal cap");
        }
    }

    /// Total deployed principal never exceeds the global cap.
    function invariant_totalDeployedCapNeverExceeded() public view {
        assertLe(pool.totalDeployed(), pool.maxTotalDeployed(), "global deployed cap");
    }

    /// NAV is exactly idle plus what the venues hold: no double-counting, no value invented.
    function invariant_accountingConsistent() public view {
        uint256 sum;
        for (uint256 i; i < venues.length; i++) sum += venues[i].balanceOf(address(pool));
        assertEq(pool.totalAssets(), pool.idleBalance() + sum, "NAV = idle + venue balances");
    }

    /// Outstanding shares are always backed by assets.
    function invariant_sharesBacked() public view {
        if (pool.totalSupply() > 0) assertGt(pool.totalAssets(), 0, "shares must be backed by NAV");
    }

    /// The sum of every depositor's redeemable claim never exceeds NAV (nobody can over-withdraw).
    function invariant_claimsWithinAssets() public view {
        uint256 claims;
        for (uint256 i; i < 3; i++) claims += pool.convertToAssets(pool.balanceOf(actorList[i]));
        assertLe(claims, pool.totalAssets() + 3, "aggregate claims <= NAV (+dust)");
    }
}
