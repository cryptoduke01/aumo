// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SelfHostedEquityOracle} from "../src/oracles/SelfHostedEquityOracle.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";

/// @notice MAINNET deploy for Stocks on X Layer (chain 196). Stands up ONE self-hosted equity oracle
///         (fed by the agent from Finnhub) shared across every stock, then one at-risk EquityPool +
///         EquityAdapter per stock, each routing USD₮0 -> USDG -> w<SYM>x on Uniswap V3. The wrapped
///         xStock (w<SYM>x) is where the DeFi liquidity lives; addresses + pool depth are verified in
///         STOCKS-VENUES.md. Launches the four liquidity-ready names (NVDA, AAPL, MSFT, META); add the
///         rest later by extending the arrays once their pools deepen.
///
///         Broadcaster must be VAULT_OWNER. Set EQUITY_AGENT to the agent key that will run the
///         executor AND feed the oracle (it becomes both the pool `agent` and the oracle `updater`).
///         Nothing here touches the safe treasury pool. Fork-test before running on mainnet.
contract DeployStocksMainnet is Script {
    // --- X Layer mainnet infra (verified on-chain 2026-09-14) ---
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736; // base asset
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8; // funnel stablecoin
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA; // Uniswap v3 SwapRouter02
    uint24 constant FEE_USDT0_USDG = 100; // 0.01% USDG/USD₮0 pool
    uint24 constant FEE_STOCK_USDG = 500; // 0.05% w<SYM>x/USDG pools

    // The live shared oracle (already fed + feeds registered). DEFAULT to reusing it so a re-run can
    // never accidentally spin up a second, unfed oracle (as happened 2026-09-20). Pass
    // SELF_HOSTED_EQUITY_ORACLE=0x0000...0001 to force a genuinely fresh oracle on a first-ever deploy.
    address constant LIVE_ORACLE = 0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2;
    address constant FRESH_SENTINEL = 0x0000000000000000000000000000000000000001;

    // Staleness window = ~5x the 60s feeder cadence: a mark older than this fails entry/exit CLOSED,
    // so a dead/lagging feeder can't keep pricing joins and exits off a stale mark (self-audit F-5 /
    // NAV-latency Medium). Tightened from 1h.
    uint256 constant MAX_AGE = 300; // 5 minutes
    uint256 constant SLIP = 200; // 2% max slippage vs the oracle across both hops
    // Anti-dilution levy (bps), RETAINED BY THE POOL — makes a joiner/leaver bear the value their own
    // action moves (exit slippage + any stale-vs-live NAV gap) instead of socializing it onto holders
    // who stay (self-audit exit-slippage + NAV-latency Mediums). Owner-tunable post-deploy.
    uint256 constant ENTRY_FEE_BPS = 25; // 0.25%
    uint256 constant EXIT_FEE_BPS = 50; // 0.50%
    // Launch risk caps (USD₮0, 6dp) — owner-tunable post-deploy via setPolicy/setDeployBudget.
    uint256 constant MAX_MOVE = 1_000e6;
    uint256 constant PER_VENUE_CAP = 50_000e6;
    uint256 constant MAX_TOTAL = 50_000e6;
    uint256 constant DEPLOY_BUDGET = 50_000e6;
    uint256 constant DEPLOY_EPOCH = 1 days;

    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");
        address agent = vm.envOr("EQUITY_AGENT", owner); // executor + oracle updater

        // Launch-ready catalog (deepest w<SYM>x/USDG liquidity). feedId = bytes32(symbol).
        bytes32[4] memory feeds =
            [bytes32("NVDA"), bytes32("AAPL"), bytes32("MSFT"), bytes32("META")];
        address[4] memory wtokens = [
            0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5, // wNVDAx
            0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f, // wAAPLx
            0x166Fbe68274b6a47e025F4ba17388c539f1fa1d0, // wMSFTx
            0xe840946FfEBCd66B7C4E95095effaFaDfa0D0e56 // wMETAx
        ];

        // Reuse the already-fed shared oracle by DEFAULT (feeds already registered, feeder pointed at
        // it). Only deploy a fresh oracle when explicitly asked via the FRESH_SENTINEL, so a plain
        // re-run can never accidentally bind the new pools to a second, unfed oracle.
        address oracleEnv = vm.envOr("SELF_HOSTED_EQUITY_ORACLE", LIVE_ORACLE);

        vm.startBroadcast();

        SelfHostedEquityOracle oracle;
        if (oracleEnv == FRESH_SENTINEL) {
            // First-ever deploy: stand up a shared oracle (agent = updater) and register every feed.
            oracle = new SelfHostedEquityOracle(agent, owner);
            for (uint256 i = 0; i < feeds.length; ++i) {
                oracle.registerFeed(feeds[i], true);
            }
        } else {
            oracle = SelfHostedEquityOracle(oracleEnv); // reuse the live oracle (feeds already registered + fed)
        }

        // 2) one at-risk pool + adapter per stock.
        for (uint256 i = 0; i < feeds.length; ++i) {
            EquityPool pool = new EquityPool(IERC20(USDT0), owner, address(oracle), feeds[i], MAX_AGE);
            bytes memory buyPath =
                abi.encodePacked(USDT0, FEE_USDT0_USDG, USDG, FEE_STOCK_USDG, wtokens[i]);
            bytes memory sellPath =
                abi.encodePacked(wtokens[i], FEE_STOCK_USDG, USDG, FEE_USDT0_USDG, USDT0);
            EquityAdapter adapter = new EquityAdapter(
                USDT0, wtokens[i], address(oracle), feeds[i], ROUTER, address(pool), buyPath, sellPath, MAX_AGE, SLIP
            );

            pool.setVenueAllowed(address(adapter), true);
            pool.setPolicy(MAX_MOVE, PER_VENUE_CAP, MAX_TOTAL);
            pool.setDeployBudget(DEPLOY_BUDGET, DEPLOY_EPOCH);
            pool.setFees(ENTRY_FEE_BPS, EXIT_FEE_BPS);
            pool.setAgent(agent); // the Railway agent drives allocation

            console2.log("--- stock ---");
            console2.logBytes32(feeds[i]);
            console2.log("pool:   ", address(pool));
            console2.log("adapter:", address(adapter));
            console2.log("wtoken: ", wtokens[i]);
        }

        vm.stopBroadcast();

        console2.log("=== SelfHostedEquityOracle:", address(oracle));
        console2.log("owner:", owner, " agent/updater:", agent);
        console2.log("Set SELF_HOSTED_EQUITY_ORACLE + EQUITY_SYMBOLS=NVDA,AAPL,MSFT,META on the feeder.");
    }
}
