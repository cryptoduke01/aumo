// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../../src/AumoPool.sol";
import {ZapDeposit} from "../../src/ZapDeposit.sol";

/// @notice Fork test against real X Layer mainnet (chainId 196). Proves the one-click USDG deposit:
///         a USDG holder zaps into the USDT0 pool in a single call, USDG is swapped to USDT0 on the
///         live 0.01% pool behind a floor, and pool shares are minted straight to the depositor. Also
///         covers the USDT0 passthrough (no swap). Runs only with RUN_FORK=1 + a mainnet RPC.
contract ZapDepositForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant UNI_ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    uint24 constant FEE = 100;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");

    AumoPool pool;
    ZapDeposit zap;
    bool active;

    function setUp() public {
        if (!vm.envOr("RUN_FORK", false)) return;
        string memory rpc = vm.envOr("XLAYER_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        vm.prank(owner);
        pool = new AumoPool(IERC20(USDT0), owner);
        zap = new ZapDeposit(address(pool), UNI_ROUTER);
        active = true;
    }

    function test_zap_usdg_deposit_mints_shares_to_depositor() public {
        if (!active) {
            vm.skip(true);
            return;
        }

        uint256 amountIn = 500e6; // 500 USDG
        deal(USDG, alice, amountIn);

        vm.startPrank(alice);
        IERC20(USDG).approve(address(zap), amountIn);
        uint256 minOut = (amountIn * 98) / 100; // 2% swap floor
        uint256 shares = zap.zapDeposit(USDG, FEE, amountIn, minOut, alice);
        vm.stopPrank();

        assertGt(shares, 0, "shares minted");
        // Depositor can redeem ~ what they put in, minus the round-trip swap cost on the deep 0.01% pool.
        assertGt(pool.maxWithdraw(alice), (amountIn * 97) / 100, "redeemable within swap cost of deposit");
        // Custody-free: the zap keeps nothing and holds no standing balance.
        assertEq(IERC20(USDT0).balanceOf(address(zap)), 0, "zap holds no USDT0");
        assertEq(IERC20(USDG).balanceOf(address(zap)), 0, "zap holds no USDG");
    }

    function test_zap_usdt0_passthrough_no_swap() public {
        if (!active) {
            vm.skip(true);
            return;
        }

        uint256 amountIn = 300e6; // 300 USDT0, already the pool asset
        deal(USDT0, alice, amountIn);

        vm.startPrank(alice);
        IERC20(USDT0).approve(address(zap), amountIn);
        uint256 shares = zap.zapDeposit(USDT0, 0, amountIn, amountIn, alice); // minOut == amountIn, no swap
        vm.stopPrank();

        assertGt(shares, 0, "shares minted");
        assertApproxEqAbs(pool.maxWithdraw(alice), amountIn, 2, "1:1 passthrough, no swap cost");
        assertEq(IERC20(USDT0).balanceOf(address(zap)), 0, "zap holds no USDT0");
    }
}
