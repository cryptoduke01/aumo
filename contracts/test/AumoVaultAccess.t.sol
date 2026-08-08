// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AumoVault} from "../src/AumoVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockVenueAdapter} from "./mocks/MockVenueAdapter.sol";

/// @notice Access control, input validation, and agent-rotation edges. Complements
///         AumoVault.t.sol (which proves the allocation caps) to lock down the surface
///         an attacker or a buggy agent could reach.
contract AumoVaultAccessTest is Test {
    MockERC20 usdt0;
    AumoVault vault;
    MockVenueAdapter venue;

    address owner = address(this);
    address agent = address(0xA9E17);
    address stranger = address(0xBEEF);

    uint256 constant U = 1e6;

    function setUp() public {
        usdt0 = new MockERC20("USDT0", "USDT0", 6);
        vault = new AumoVault(address(usdt0), owner);
        venue = new MockVenueAdapter(address(usdt0));
        usdt0.mint(owner, 1_000 * U);
        usdt0.approve(address(vault), type(uint256).max);
        vault.deposit(1_000 * U);
        vault.setAgent(agent);
        vault.setVenueAllowed(address(venue), true);
        vault.setPolicy(200 * U, 500 * U, 800 * U);
    }

    // --- owner-only policy surface ---

    function test_SetAgent_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.setAgent(stranger);
    }

    function test_SetVenueAllowed_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.setVenueAllowed(address(venue), false);
    }

    function test_SetPolicy_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.setPolicy(1, 1, 1);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.pause();
    }

    function test_Unpause_OnlyOwner() public {
        vault.pause();
        vm.prank(stranger);
        vm.expectRevert();
        vault.unpause();
    }

    // --- input validation ---

    function test_Deposit_RevertZero() public {
        vm.expectRevert(AumoVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_Withdraw_RevertZero() public {
        vm.expectRevert(AumoVault.ZeroAmount.selector);
        vault.withdraw(0);
    }

    function test_Allocate_RevertZero() public {
        vm.prank(agent);
        vm.expectRevert(AumoVault.ZeroAmount.selector);
        vault.allocate(address(venue), 0, "x");
    }

    function test_Deallocate_RevertZero() public {
        vm.prank(agent);
        vm.expectRevert(AumoVault.ZeroAmount.selector);
        vault.deallocate(address(venue), 0);
    }

    function test_Deallocate_RevertNotAgent() public {
        vm.prank(agent);
        vault.allocate(address(venue), 100 * U, "in");
        vm.prank(stranger);
        vm.expectRevert(AumoVault.NotAgent.selector);
        vault.deallocate(address(venue), 100 * U);
    }

    // --- a venue whose asset != the vault asset can never be allowlisted ---

    function test_SetVenueAllowed_RevertAssetMismatch() public {
        MockERC20 other = new MockERC20("OTHER", "OTH", 6);
        MockVenueAdapter wrong = new MockVenueAdapter(address(other));
        vm.expectRevert(AumoVault.AssetMismatch.selector);
        vault.setVenueAllowed(address(wrong), true);
    }

    // --- rotating the agent immediately revokes the old key ---

    function test_AgentRotation_RevokesOldKey() public {
        address newAgent = address(0xC0FFEE);
        vault.setAgent(newAgent);

        vm.prank(agent); // the old agent
        vm.expectRevert(AumoVault.NotAgent.selector);
        vault.allocate(address(venue), 100 * U, "x");

        vm.prank(newAgent);
        vault.allocate(address(venue), 100 * U, "x");
        assertEq(vault.allocated(address(venue)), 100 * U);
    }

    // --- audit regressions ---

    function test_Allowance_ZeroedAfterAllocate() public {
        vm.prank(agent);
        vault.allocate(address(venue), 100 * U, "supply");
        assertEq(usdt0.allowance(address(vault), address(venue)), 0, "no standing allowance");
    }

    function test_RenounceOwnership_Reverts() public {
        vm.expectRevert(AumoVault.RenounceDisabled.selector);
        vault.renounceOwnership();
    }

    function test_Deallocate_RevertsUnknownVenue() public {
        vm.prank(agent);
        vm.expectRevert(AumoVault.VenueNotAllowed.selector);
        vault.deallocate(address(0xDEAD), 1);
    }
}
