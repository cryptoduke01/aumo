// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SelfHostedEquityOracle} from "../src/oracles/SelfHostedEquityOracle.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";

/// @notice MAINNET deploy for the GOLD pool on X Layer (chain 196): ONE at-risk EquityPool holding
///         PAXGy (Paxos yield-bearing tokenized gold) through one EquityAdapter, routed USD₮0 -> USDG
///         -> PAXGy on Uniswap v3. Reuses the SAME hardened EquityAdapter/EquityPool as the stocks
///         (anti-dilution levy + tighter staleness + obs-clamp) and the SAME shared self-hosted oracle,
///         where the feeder posts a `PAXGY` price = Accountant.getRate() (gold) x gold/USD each cycle.
///         Proven end-to-end on a live fork in test/PaxgyFork.t.sol.
///
///         This is OPT-IN, at-risk GOLD exposure (its USD value moves with gold), NOT the safe pool.
///         Broadcaster must be VAULT_OWNER (also the oracle owner, so it can register the feed).
///         EQUITY_AGENT = the Railway agent (pool `agent` + oracle `updater`). Fork-test before running.
contract DeployGoldMainnet is Script {
    // --- X Layer mainnet infra (verified on-chain) ---
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA; // Uniswap v3 SwapRouter02
    address constant PAXGY = 0x6c6494Fd9962eB98B94ffA48F6679058F820700e; // Paxos yield-bearing gold (18 dec)
    uint24 constant FEE_USDT0_USDG = 100; // 0.01%
    uint24 constant FEE_PAXGY_USDG = 500; // 0.05% (the live PAXGy/USDG pool ~$497K)

    // Reuse the live shared oracle (already fed + fed by the same updater). Feed id for gold.
    address constant LIVE_ORACLE = 0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2;
    bytes32 constant FEED = bytes32("PAXGY");

    uint256 constant MAX_AGE = 300; // 5 min: fail entry/exit closed if the feeder lags
    uint256 constant SLIP = 200; // 2% max slippage vs the oracle across both hops
    uint256 constant ENTRY_FEE_BPS = 25; // 0.25% anti-dilution levy, retained by the pool
    uint256 constant EXIT_FEE_BPS = 50; // 0.50%
    // Launch caps (USD₮0, 6dp), owner-tunable. Held DELIBERATELY SMALL vs the ~$497K pool depth so a
    // deposit or the agent's buy never moves the pool hard or strands size it can't exit cleanly.
    uint256 constant MAX_MOVE = 1_000e6;
    uint256 constant PER_VENUE_CAP = 20_000e6;
    uint256 constant MAX_TOTAL = 20_000e6;
    uint256 constant DEPLOY_BUDGET = 20_000e6;
    uint256 constant DEPLOY_EPOCH = 1 days;

    function run() external {
        address owner = vm.envAddress("VAULT_OWNER");
        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");
        address agent = vm.envOr("EQUITY_AGENT", owner);
        address oracleAddr = vm.envOr("SELF_HOSTED_EQUITY_ORACLE", LIVE_ORACLE);

        vm.startBroadcast();

        // Register the gold feed on the shared oracle (owner-only; broadcaster is the owner). Idempotent.
        SelfHostedEquityOracle(oracleAddr).registerFeed(FEED, true);

        EquityPool pool = new EquityPool(IERC20(USDT0), owner, oracleAddr, FEED, MAX_AGE);
        bytes memory buyPath = abi.encodePacked(USDT0, FEE_USDT0_USDG, USDG, FEE_PAXGY_USDG, PAXGY);
        bytes memory sellPath = abi.encodePacked(PAXGY, FEE_PAXGY_USDG, USDG, FEE_USDT0_USDG, USDT0);
        EquityAdapter adapter = new EquityAdapter(
            USDT0, PAXGY, oracleAddr, FEED, ROUTER, address(pool), buyPath, sellPath, MAX_AGE, SLIP
        );

        pool.setVenueAllowed(address(adapter), true);
        pool.setPolicy(MAX_MOVE, PER_VENUE_CAP, MAX_TOTAL);
        pool.setDeployBudget(DEPLOY_BUDGET, DEPLOY_EPOCH);
        pool.setFees(ENTRY_FEE_BPS, EXIT_FEE_BPS);
        pool.setAgent(agent);

        vm.stopBroadcast();

        console2.log("=== Gold (PAXGy) EquityPool:", address(pool));
        console2.log("adapter:", address(adapter));
        console2.log("oracle (reused):", oracleAddr);
        console2.log("owner:", owner, " agent:", agent);
        console2.log("Feeder: add a PAXGY feed = Accountant.getRate() x gold/USD; register done here.");
    }
}
