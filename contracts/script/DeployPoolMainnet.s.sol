// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {RwaUsdgAdapter} from "../src/adapters/RwaUsdgAdapter.sol";

/// @notice One-command X Layer MAINNET launch (chainId 196): the multi-depositor AumoPool
///         (ERC-4626) plus a real Aave v3 adapter and the USDG RWA adapter, wired and allowlisted.
///         The pool deploys PAUSED and (if SAFE is set) with ownership handed to a multisig; go-live
///         is a deliberate unpause from the Safe after on-chain verification.
///
/// Real X Layer mainnet addresses (aave-address-book/src/AaveV3XLayer.sol, verified on-chain):
///   USDT0 (USD₮0, 6dp)  0x779Ded0c9e1022225f8E0630b35a9b54bE713736
///   Aave v3 Pool        0xE3F3Caefdd7180F884c01E57f65Df979Af84f116
///   aXlrUSDT0           0xF356ae412dB5df43BD3a10746f7ad4e1C4De4297
///
/// Usage (spends real gas; broadcaster must equal VAULT_OWNER; AGENT_ADDRESS is required and must
/// differ from the owner; SAFE is the multisig that will hold ownership — strongly recommended):
///   VAULT_OWNER=0xYou AGENT_ADDRESS=0xHotAgent SAFE=0xSafe \
///   MAX_MOVE=100000000 PER_VENUE_CAP=1000000000 MAX_TOTAL=5000000000 \
///   forge script script/DeployPoolMainnet.s.sol:DeployPoolMainnet \
///     --rpc-url https://rpc.xlayer.tech --private-key "$PRIVATE_KEY" --broadcast
///
/// Post-deploy runbook: Safe calls acceptOwnership(); verify owner()==SAFE, agent()!=owner,
/// paused()==true, caps/budgets sane, venueAllowed(aave/usdg)==true; seed a tiny deposit; then
/// unpause() from the Safe as the public go-live.
contract DeployPoolMainnet is Script {
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant AAVE_POOL = 0xE3F3Caefdd7180F884c01E57f65Df979Af84f116;
    address constant AUSDT0 = 0xF356ae412dB5df43BD3a10746f7ad4e1C4De4297;
    // RWA venue: USDG (Global Dollar, RWA-reserve-backed) supplied to Aave, USDT0<->USDG on Uniswap.
    address constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;
    address constant AUSDG = 0x228765a3C18065C923F23a0CCb6c7cEFB3eA2223;
    address constant UNI_ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA; // SwapRouter02
    uint24 constant USDG_FEE = 100; // live USDT0/USDG pool fee tier (0.01%)
    uint256 constant USDG_SLIPPAGE_BPS = 200; // 2% swap floor; a thin swap reverts, never bleeds

    function run() external {
        require(block.chainid == 196, "not X Layer mainnet");

        address owner = vm.envAddress("VAULT_OWNER");
        address agent = vm.envAddress("AGENT_ADDRESS"); // required; the frequently-signing hot key
        address safe = vm.envOr("SAFE", address(0)); // multisig to hold ownership (recommended)

        // Conservative launch caps by default (in USDT0 6dp): $100 per move, $1000 per venue,
        // $5000 total deployed. Override via env for a larger launch.
        uint256 maxMove = vm.envOr("MAX_MOVE", uint256(100e6));
        uint256 perVenue = vm.envOr("PER_VENUE_CAP", uint256(1_000e6));
        uint256 maxTotal = vm.envOr("MAX_TOTAL", uint256(5_000e6));
        // Churn loss budget: most realized round-trip loss the agent may cause per epoch (~1% of max
        // total / day). Deploy budget: caps allocate throughput per epoch (~3x total / day) so churn
        // can't be re-staged through the unmetered redeem path without bound. USDG valuation discount:
        // the realistic marginal round-trip cost used to price the position (decoupled from the 2%
        // swap floor so routine moves don't step NAV).
        uint256 maxEpochLoss = vm.envOr("MAX_EPOCH_LOSS", maxTotal / 100);
        uint256 lossEpoch = vm.envOr("LOSS_EPOCH", uint256(1 days));
        uint256 maxEpochDeploy = vm.envOr("MAX_EPOCH_DEPLOY", maxTotal * 3);
        uint256 usdgValuationBps = vm.envOr("USDG_VALUATION_BPS", uint256(30));

        require(msg.sender == owner, "broadcaster must be VAULT_OWNER");
        require(agent != address(0) && agent != owner, "AGENT_ADDRESS must be set and != owner");
        require(maxMove > 0, "set MAX_MOVE");
        require(perVenue >= maxMove, "PER_VENUE_CAP must be >= MAX_MOVE");
        require(maxTotal >= perVenue, "MAX_TOTAL must be >= PER_VENUE_CAP");

        // The adapter owner (retunes slippage, emergency exit) is the Safe if given, else the EOA.
        address adapterOwner = safe != address(0) ? safe : owner;

        vm.startBroadcast();
        AumoPool pool = new AumoPool(IERC20(USDT0), owner);
        // Venue 1: real Aave USDT0 lending (fork-proven).
        AaveV3Adapter aave = new AaveV3Adapter(USDT0, AAVE_POOL, AUSDT0, address(pool));
        // Venue 2: RWA-backed USDG yield (fork-proven) — the agent aggregates across both.
        RwaUsdgAdapter usdg = new RwaUsdgAdapter(
            USDT0, USDG, AUSDG, AAVE_POOL, UNI_ROUTER, address(pool), adapterOwner, USDG_FEE, USDG_SLIPPAGE_BPS, usdgValuationBps
        );
        pool.setVenueAllowed(address(aave), true);
        pool.setVenueAllowed(address(usdg), true);
        pool.setPolicy(maxMove, perVenue, maxTotal);
        pool.setLossBudget(maxEpochLoss, lossEpoch); // bound agent churn/value destruction
        pool.setDeployBudget(maxEpochDeploy); // cap re-staging via the unmetered redeem path
        pool.setAgent(agent);
        pool.pause(); // deploy paused; go-live is a deliberate unpause after verification
        if (safe != address(0)) pool.transferOwnership(safe); // Ownable2Step: Safe must accept
        vm.stopBroadcast();

        console2.log("USDT0 (asset): ", USDT0);
        console2.log("AumoPool:      ", address(pool));
        console2.log("AaveV3Adapter: ", address(aave));
        console2.log("RwaUsdgAdapter:", address(usdg));
        console2.log("owner (now):   ", owner);
        console2.log("owner (pending Safe):", safe);
        console2.log("agent:         ", agent);
        console2.log("caps (maxMove/perVenue/maxTotal):", maxMove, perVenue, maxTotal);
        console2.log("loss/deploy budget:", maxEpochLoss, maxEpochDeploy);
        console2.log("PAUSED: true. Transfer ownership to Safe, verify, then unpause to go live.");
        if (safe == address(0)) {
            console2.log("WARNING: SAFE not set. Ownership is on the deployer EOA. Move it to a multisig before funding.");
        }
    }
}
