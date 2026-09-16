// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";

/// @notice MAINNET deploy for the DIVERSIFIED EQUITY BASKET on X Layer (chain 196). ONE at-risk
///         EquityPool that holds an equal-weight basket of the launch stocks (NVDA, AAPL, MSFT, META)
///         through one EquityAdapter per stock, all bound to this pool. Reuses the EXISTING shared
///         SelfHostedEquityOracle (already fed by the agent, feeds already registered) — no new oracle.
///
///         Thesis (see .internal/BASKET.md): diversification is the one cycle-proven drawdown reducer
///         (~43% single-name -> ~32% basket over 5y incl. the 2022 bear). The agent only MAINTAINS
///         equal weight (rebalances on drift); it does not time or pick. No timing claim.
///
///         Coexists with the single-stock pools (DeployStocksMainnet) — this is the diversified option.
///         Broadcaster must be VAULT_OWNER. EQUITY_AGENT = the Railway agent (pool `agent`). The oracle
///         is read-only here, so its updater is unchanged. Fork-test before running on mainnet.
contract DeployBasketMainnet is Script {
    // --- X Layer mainnet infra (verified on-chain 2026-09-14) ---
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA; // Uniswap v3 SwapRouter02
    uint24 constant FEE_USDT0_USDG = 100; // 0.01%
    uint24 constant FEE_STOCK_USDG = 500; // 0.05%

    // Existing shared oracle (DeployStocksMainnet output; already fed by the agent). Override with
    // SELF_HOSTED_EQUITY_ORACLE if it is ever migrated.
    address constant ORACLE = 0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2;

    uint256 constant MAX_AGE = 1 hours; // feed older than this = market closed = entry/exit frozen
    uint256 constant SLIP = 200; // 2% max slippage vs the oracle across both hops
    // Launch caps (USD₮0, 6dp), owner-tunable post-deploy. PER_VENUE_CAP > equal-weight target (NAV/4)
    // to leave rebalance headroom; MAX_TOTAL caps the whole basket.
    uint256 constant MAX_MOVE = 1_000e6;
    uint256 constant PER_VENUE_CAP = 20_000e6;
    uint256 constant MAX_TOTAL = 50_000e6;
    uint256 constant DEPLOY_BUDGET = 50_000e6;
    uint256 constant DEPLOY_EPOCH = 1 days;

    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");
        address agent = vm.envOr("EQUITY_AGENT", owner);
        address oracle = vm.envOr("SELF_HOSTED_EQUITY_ORACLE", ORACLE);

        bytes32[4] memory feeds =
            [bytes32("NVDA"), bytes32("AAPL"), bytes32("MSFT"), bytes32("META")];
        address[4] memory wtokens = [
            0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5, // wNVDAx
            0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f, // wAAPLx
            0x166Fbe68274b6a47e025F4ba17388c539f1fa1d0, // wMSFTx
            0xe840946FfEBCd66B7C4E95095effaFaDfa0D0e56 // wMETAx
        ];

        vm.startBroadcast();

        // One basket pool. Market clock = NVDA feed (all US equities share the same session, so any
        // registered, liquid feed is a valid market-open signal).
        EquityPool pool =
            new EquityPool(IERC20(USDT0), owner, oracle, bytes32("NVDA"), MAX_AGE);

        // One adapter per stock, all bound to this pool; allowlist each as a venue.
        for (uint256 i = 0; i < feeds.length; ++i) {
            bytes memory buyPath =
                abi.encodePacked(USDT0, FEE_USDT0_USDG, USDG, FEE_STOCK_USDG, wtokens[i]);
            bytes memory sellPath =
                abi.encodePacked(wtokens[i], FEE_STOCK_USDG, USDG, FEE_USDT0_USDG, USDT0);
            EquityAdapter adapter = new EquityAdapter(
                USDT0, wtokens[i], oracle, feeds[i], ROUTER, address(pool), buyPath, sellPath, MAX_AGE, SLIP
            );
            pool.setVenueAllowed(address(adapter), true);

            console2.log("--- basket venue ---");
            console2.logBytes32(feeds[i]);
            console2.log("adapter:", address(adapter));
            console2.log("wtoken: ", wtokens[i]);
        }

        pool.setPolicy(MAX_MOVE, PER_VENUE_CAP, MAX_TOTAL);
        pool.setDeployBudget(DEPLOY_BUDGET, DEPLOY_EPOCH);
        pool.setAgent(agent);

        vm.stopBroadcast();

        console2.log("=== Basket EquityPool:", address(pool));
        console2.log("oracle (reused):", oracle);
        console2.log("owner:", owner, " agent:", agent);
        console2.log("Set EQUITY_BASKET_POOL + EQUITY_BASKET_VENUES (the 4 adapters above) on the agent.");
    }
}
