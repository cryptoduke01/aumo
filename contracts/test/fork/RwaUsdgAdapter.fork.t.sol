// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../../src/AumoPool.sol";
import {RwaUsdgAdapter} from "../../src/adapters/RwaUsdgAdapter.sol";

/// @notice Fork test against the real X Layer mainnet (chainId 196). Proves the RWA venue end to
///         end: the pool's USDT0 is swapped to USDG on live Uniswap v3, supplied to live Aave v3,
///         accrues, and is fully retreated back to USDT0 in the pool. Auto-discovers the
///         USDT0/USDG fee tier from the Uniswap factory. Runs only with RUN_FORK=1 + a mainnet RPC.
///
/// Verified X Layer mainnet addresses:
///   USDT0   0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   USDG    0x4ae46a509F6b1D9056937BA4500cb143933D2dc8   (aave-address-book)
///   aUSDG   0x228765a3C18065C923F23a0CCb6c7cEFB3eA2223
///   AavePool 0xE3F3Caefdd7180F884c01E57f65Df979Af84f116
///   UniV3Factory 0x4b2ab38dbf28d31d467aa8993f6c2585981d6804
///   SwapRouter02 0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca
interface IUniV3Factory {
    function getPool(address, address, uint24) external view returns (address);
}

interface IUniV3Pool {
    function liquidity() external view returns (uint128);
}

contract RwaUsdgAdapterForkTest is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant AUSDG = 0x228765a3C18065C923F23a0CCb6c7cEFB3eA2223;
    address constant AAVE_POOL = 0xE3F3Caefdd7180F884c01E57f65Df979Af84f116;
    address constant FACTORY = 0x4B2ab38DBF28D31D467aA8993f6c2585981D6804;
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address alice = makeAddr("alice");

    AumoPool pool;
    RwaUsdgAdapter adapter;
    bool active;

    function setUp() public {
        if (!vm.envOr("RUN_FORK", false)) return;
        string memory rpc = vm.envOr("XLAYER_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        uint24 fee = _discoverFee();
        if (fee == 0) return; // no liquid USDT0/USDG pool on this fork; skip cleanly

        vm.startPrank(owner);
        pool = new AumoPool(IERC20(USDT0), owner);
        // owner=owner, 2% swap floor, 30bps valuation discount
        adapter = new RwaUsdgAdapter(USDT0, USDG, AUSDG, AAVE_POOL, ROUTER, address(pool), owner, fee, 200, 30);
        pool.setVenueAllowed(address(adapter), true);
        pool.setPolicy(1_000e6, 5_000e6, 10_000e6);
        pool.setLossBudget(500e6, 1 days); // generous churn budget so the legit retreat clears
        pool.setAgent(agent);
        vm.stopPrank();
        active = true;
    }

    function _discoverFee() internal view returns (uint24) {
        uint24[4] memory tiers = [uint24(100), 500, 3000, 10000];
        for (uint256 i; i < tiers.length; ++i) {
            address p = IUniV3Factory(FACTORY).getPool(USDT0, USDG, tiers[i]);
            if (p != address(0) && IUniV3Pool(p).liquidity() > 0) return tiers[i];
        }
        return 0;
    }

    function test_rwa_usdg_supply_and_retreat_on_real_xlayer() public {
        if (!active) {
            vm.skip(true);
            return;
        }

        uint256 amount = 1_000e6;
        deal(USDT0, alice, amount);
        vm.startPrank(alice);
        IERC20(USDT0).approve(address(pool), amount);
        pool.deposit(amount, alice);
        vm.stopPrank();
        assertEq(pool.idleBalance(), amount, "pool funded");

        // Agent routes USDT0 -> USDG (Uniswap) -> Aave supply.
        vm.prank(agent);
        pool.allocate(address(adapter), amount, "rwa-usdg");
        assertEq(pool.idleBalance(), 0, "idle deployed");

        uint256 pos = pool.venueBalance(address(adapter)); // aUSDG, ~USDT0 terms
        assertGt(pos, (amount * 97) / 100, "supplied position within swap cost of principal");

        // Real yield accrues on the live Aave USDG market.
        vm.warp(block.timestamp + 30 days);
        assertGe(pool.venueBalance(address(adapter)), pos, "position accrues");

        // Full retreat: USDG out of Aave, swapped back to USDT0, returned to the pool.
        vm.prank(agent);
        pool.deallocate(address(adapter), type(uint256).max);
        assertEq(pool.allocated(address(adapter)), 0, "principal cleared");
        assertGt(pool.idleBalance(), (amount * 94) / 100, "principal returned minus round-trip swap cost");
    }
}
