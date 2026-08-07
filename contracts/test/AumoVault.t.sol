// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AumoVault} from "../src/AumoVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVenueAdapter} from "./mocks/MockVenueAdapter.sol";

/// @notice Proves the trust core: the agent physically cannot exceed its guardrails.
contract AumoVaultTest is Test {
    MockERC20 usdt0;
    AumoVault vault;
    MockVenueAdapter venue;

    address owner = address(this);
    address agent = address(0xA9E17);
    address stranger = address(0xBEEF);

    uint256 constant U = 1e6; // USDT0 has 6 decimals

    function setUp() public {
        usdt0 = new MockERC20("USDT0", "USDT0", 6);
        vault = new AumoVault(address(usdt0), owner);
        venue = new MockVenueAdapter(address(usdt0));

        usdt0.mint(owner, 1_000 * U);
        usdt0.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * U);

        vault.setAgent(agent);
        vault.setVenueAllowed(address(venue), true);
        // maxMove 200, perVenueCap 500, totalCap 800
        vault.setPolicy(200 * U, 500 * U, 800 * U);
    }

    // --- happy path ---

    function test_DepositIsIdle() public view {
        assertEq(vault.idleBalance(), 1_000 * U);
    }

    function test_Allocate_WithinCaps() public {
        vm.prank(agent);
        vault.allocate(address(venue), 150 * U, "aave-supply");
        assertEq(vault.allocated(address(venue)), 150 * U);
        assertEq(vault.totalDeployed(), 150 * U);
        assertEq(vault.idleBalance(), 850 * U);
        assertEq(vault.venueBalance(address(venue)), 150 * U);
    }

    function test_Deallocate_ReturnsPrincipal() public {
        vm.startPrank(agent);
        vault.allocate(address(venue), 200 * U, "in");
        vault.deallocate(address(venue), 200 * U);
        vm.stopPrank();
        assertEq(vault.allocated(address(venue)), 0);
        assertEq(vault.totalDeployed(), 0);
        assertEq(vault.idleBalance(), 1_000 * U);
    }

    function test_Deallocate_RealizesYield() public {
        vm.prank(agent);
        vault.allocate(address(venue), 200 * U, "in");
        // simulate 10 USDT0 of yield sitting in the venue
        usdt0.mint(address(venue), 10 * U);
        venue.accrue(address(vault), 10 * U);
        vm.prank(agent);
        vault.deallocate(address(venue), 210 * U);
        assertEq(vault.allocated(address(venue)), 0);
        assertEq(vault.idleBalance(), 1_010 * U); // principal back + realized yield
    }

    // --- guardrails: every one must revert ---

    function test_Allocate_RevertNotAgent() public {
        vm.prank(stranger);
        vm.expectRevert(AumoVault.NotAgent.selector);
        vault.allocate(address(venue), 100 * U, "x");
    }

    function test_Allocate_RevertNotAllowlisted() public {
        MockVenueAdapter rogue = new MockVenueAdapter(address(usdt0));
        vm.prank(agent);
        vm.expectRevert(AumoVault.VenueNotAllowed.selector);
        vault.allocate(address(rogue), 100 * U, "x");
    }

    function test_Allocate_RevertOverMoveSize() public {
        vm.prank(agent);
        vm.expectRevert(AumoVault.MoveTooLarge.selector);
        vault.allocate(address(venue), 201 * U, "x");
    }

    function test_Allocate_RevertOverPerVenueCap() public {
        vm.startPrank(agent);
        vault.allocate(address(venue), 200 * U, "1"); // 200
        vault.allocate(address(venue), 200 * U, "2"); // 400
        vm.expectRevert(AumoVault.PerVenueCapExceeded.selector);
        vault.allocate(address(venue), 200 * U, "3"); // 600 > 500 cap
        vm.stopPrank();
    }

    function test_Allocate_RevertOverTotalCap() public {
        MockVenueAdapter v2 = new MockVenueAdapter(address(usdt0));
        vault.setVenueAllowed(address(v2), true);
        vm.startPrank(agent);
        vault.allocate(address(venue), 200 * U, "1"); // venue 200
        vault.allocate(address(venue), 200 * U, "2"); // venue 400
        vault.allocate(address(v2), 200 * U, "3"); // total 600
        vault.allocate(address(v2), 200 * U, "4"); // total 800 == cap, ok
        vm.expectRevert(AumoVault.TotalCapExceeded.selector);
        vault.allocate(address(v2), 1 * U, "5"); // 801 > 800
        vm.stopPrank();
    }

    function test_Allocate_RevertWhenPaused() public {
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(); // Pausable: EnforcedPause
        vault.allocate(address(venue), 100 * U, "x");
    }

    function test_KillSwitch_ThenResume() public {
        vault.pause();
        vm.prank(agent);
        vm.expectRevert();
        vault.allocate(address(venue), 100 * U, "x");

        vault.unpause();
        vm.prank(agent);
        vault.allocate(address(venue), 100 * U, "x");
        assertEq(vault.allocated(address(venue)), 100 * U);
    }

    // --- funds custody: agent can never withdraw to itself ---

    function test_Withdraw_OnlyOwner() public {
        vm.prank(agent);
        vm.expectRevert(); // Ownable: OwnableUnauthorizedAccount
        vault.withdraw(1 * U);
    }

    function test_Withdraw_RevertOverIdle() public {
        vm.prank(agent);
        vault.allocate(address(venue), 200 * U, "in"); // idle 800
        vm.expectRevert(AumoVault.InsufficientIdle.selector);
        vault.withdraw(900 * U);
    }

    function test_Deallocate_AlwaysAllowedEvenWhenPaused() public {
        vm.prank(agent);
        vault.allocate(address(venue), 200 * U, "in");
        vault.pause();
        // retreat must still work while paused
        vm.prank(agent);
        vault.deallocate(address(venue), 200 * U);
        assertEq(vault.allocated(address(venue)), 0);
    }
}
