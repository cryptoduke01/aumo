// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockEquityOracle} from "../test/mocks/MockEquityOracle.sol";
import {MockSwapRouter} from "../test/mocks/MockSwapRouter.sol";

/// @notice Stand up the OPT-IN, at-risk equity feature on X Layer testnet for the 3-day soak, wired
///         end to end against mocks we control: a test xStock, a settable equity oracle (the market
///         clock), and a decimals-aware swap router. Reuses the existing testnet USD₮0 so the same
///         faucet/agent/web plumbing recognises the asset. Broadcaster must be VAULT_OWNER.
///
///         This deploys the REAL EquityPool + EquityAdapter — only the oracle, stock and router are
///         mocks (X Layer's real Chainlink product/addresses and the live xStock/USD₮0 pool are the
///         two immutables confirmed during the soak, before mainnet). During the soak, tick the
///         oracle in step with the router (`MockEquityOracle.set` / `MockSwapRouter.setPrice`) to
///         drive NAV and to let the clock go stale outside "market hours" so the gate is exercised.
contract DeployEquityPoolTestnet is Script {
    address constant TEST_USDT0 = 0xFc440733d882f28012B190b11Bbec56b44508448;

    bytes32 constant FEED = bytes32("NVDA");
    uint256 constant INIT_PX = 180e18; // $180 / share to start
    uint256 constant MAX_AGE = 1 hours; // clock older than this = market closed = entry/exit frozen
    uint256 constant SLIP = 200; // 2% max slippage vs the oracle on every swap
    uint24 constant POOL_FEE = 3000; // v3 fee tier the mock router ignores; real pool sets this

    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");

        vm.startBroadcast();

        // --- market infrastructure (mocks we control for the soak) ---
        MockERC20 stock = new MockERC20("NVDAx (test)", "NVDAx", 18);
        MockEquityOracle oracle = new MockEquityOracle();
        oracle.set(FEED, INIT_PX, block.timestamp); // fresh: market open at deploy
        MockSwapRouter router = new MockSwapRouter(TEST_USDT0, address(stock), 6, 18, INIT_PX);

        // Fund the router so it can fill both directions (buy stock / sell stock).
        MockERC20(TEST_USDT0).mint(address(router), 2_000_000e6);
        stock.mint(address(router), 2_000_000e18);

        // --- the real feature: pool first, then bind the adapter's vault to it ---
        // Testnet routes a single direct hop base -> stock. On mainnet, if the base asset does not
        // pair with the xStock directly, this becomes a multi-hop path (e.g. USD₮0 -> USDG -> xStock)
        // by encoding the extra hop here; the adapter handles either without a code change.
        EquityPool pool = new EquityPool(IERC20(TEST_USDT0), owner, address(oracle), FEED, MAX_AGE);
        bytes memory buyPath = abi.encodePacked(TEST_USDT0, POOL_FEE, address(stock));
        bytes memory sellPath = abi.encodePacked(address(stock), POOL_FEE, TEST_USDT0);
        EquityAdapter adapter = new EquityAdapter(
            TEST_USDT0, address(stock), address(oracle), FEED, address(router), address(pool), buyPath, sellPath, MAX_AGE, SLIP
        );

        pool.setVenueAllowed(address(adapter), true);
        pool.setPolicy(500e6, 5_000e6, 5_000e6); // maxMove, perVenueCap, maxTotalDeployed
        pool.setDeployBudget(5_000e6, 1 days); // bounds churn throughput per day

        // Seed the owner with test USD₮0 to drive deposits during the soak.
        MockERC20(TEST_USDT0).mint(owner, 50_000e6);

        vm.stopBroadcast();

        console2.log("EquityPool (at-risk): ", address(pool));
        console2.log("EquityAdapter:        ", address(adapter));
        console2.log("stock NVDAx (test):   ", address(stock));
        console2.log("oracle (market clock):", address(oracle));
        console2.log("swap router:          ", address(router));
        console2.log("asset (USDT0):        ", TEST_USDT0);
        console2.log("owner/agent:          ", owner);
        console2.log("feedId: NVDA  initPx: $180  maxAge: 1h  slippage: 2%");
    }
}
