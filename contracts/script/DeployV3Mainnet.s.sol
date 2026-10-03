// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AumoPool} from "../src/AumoPool.sol";
import {EquityPool} from "../src/EquityPool.sol";
import {ZapDeposit} from "../src/ZapDeposit.sol";
import {EquityAdapter} from "../src/adapters/EquityAdapter.sol";
import {AaveV3Adapter} from "../src/adapters/AaveV3Adapter.sol";
import {RwaUsdgAdapter} from "../src/adapters/RwaUsdgAdapter.sol";
import {PendlePtAdapter} from "../src/adapters/PendlePtAdapter.sol";
import {UniV3LpAdapter} from "../src/adapters/UniV3LpAdapter.sol";
import {Erc4626Adapter} from "../src/adapters/Erc4626Adapter.sol";

/// @title DeployV3Mainnet
/// @notice v3 redeploy of the Aumo pools on X Layer mainnet (chainId 196) carrying the
///         MAX_EXIT_SHORTFALL_BPS fix (commit 9f7761e): a redemption whose venue exit fails, or
///         realizes more than 5% short, now reverts with ExitShortfall instead of burning the
///         holder's shares for whatever idle cash the pool happens to hold.
///
///         The script CLONES each live v2 pool: it reads every parameter from the v2 contracts
///         on-chain (asset, owner, agent, caps, loss/deploy budgets, levy, pause state, market clock,
///         and every adapter's constructor arguments and tunables), checks the v2 wiring, then deploys
///         the same pool + adapters from the fixed source and re-applies the identical configuration.
///         Nothing is hardcoded except the v2 addresses below (env-overridable). A post-deploy check
///         re-reads both generations and reverts the whole run if any parameter differs, so a bad
///         clone fails in simulation before anything is broadcast.
///
/// ===================================================================================================
/// WHAT NEEDS REDEPLOYING (verified against live bytecode, 2026-10-03)
/// ===================================================================================================
///   AFFECTED (vulnerable `_withdraw`, deployed from cb2e41c = pre-fix):
///     EquityPool NVDA    0x9781cD1f02045c072D7D1915a215c9E46b49E1dB  adapter 0xde65eF11e35942c7E706069dc8e9Cd1bC728B616
///     EquityPool AAPL    0xDcd9c0C948ebb4D63d88FA5EC8eDE571eF1BE523  adapter 0xefeDCbe15Ab9C07d6105309B70dF8357a019B4Ef
///     EquityPool MSFT    0xbe0A87F49F424D3170804e29E5969a379Fe65626  adapter 0xaeBBABB609C411dca95C11885CFf3749356c4aD0
///     EquityPool META    0x47343D8a880c84aD1a6aD679FEdd0DC23fdA8BcC  adapter 0xb51C025146B7d4542a2515B544d4F853Aa713A82
///     Basket EquityPool  0xFe01b81F5D22Ac3647424904f7DC7ecC9EA0358d  adapters (NVDA, AAPL, MSFT, META)
///                          0xfdf7eb2a1A4F734901efB03a6a026dBb17B1A3dC 0x479e1A2B6A2B70599a3Ef3e89334cb2dcAf43f63
///                          0x5908B1143d69f363FEEc8bBc41cb73Ff26C8de40 0xFC0F4b0C9C0CF785f822079EbFb789Dbeb7DdF49
///     Gold EquityPool    0xf1833C4eAEb42df6D9eE33ea090055cf690cee56  adapter 0x6c3Dca1AA96010683bB0e7A0AEb80AbC2e4c25bF
///   Every adapter pins its pool as an immutable `vault`, so each adapter is redeployed with its pool
///   (same constructor args, new vault). The shared SelfHostedEquityOracle
///   0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2 has no redeem path and is REUSED unchanged.
///
///   NOT AFFECTED by this bug (opt-in here with V3_STABLE=true):
///     Stable AumoPool    0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F (deployed 2026-08-13 from b95ed0b).
///     Its `_withdraw` predates the realizable-settlement change (1fea83a): it transfers the full
///     amount or reverts, so it never burns shares for idle cash. It does run older code than the
///     repo (no exposure-based caps c54bf30, no Pendle F-1 entry metering 13f51d2, no realizable
///     settlement), which is a separate reason to move it, not this fix. If V3_STABLE=true the script
///     also clones its five adapters (Aave 0x9c7B.., USDG 0x468c.., Pendle 0x1276.., LP 0x483a..,
///     spUSDT 0xd14f..) and the ZapDeposit 0x29C9D4e86E587F42dadDa0b8004181EFE2D8B3df (immutable pool).
///
/// ===================================================================================================
/// MIGRATION CHECKLIST (TVL is close to zero, so this is deliberately simple)
/// ===================================================================================================
///   State at prep time: every affected v2 equity pool has totalSupply == 0 (no depositor shares;
///   AAPL holds ~0.015 USDT0 of orphaned adapter dust, the basket ~0.015 idle). The stable pool has
///   432 share-wei (~0.00002 USDT0 claimable). So there are no balances to migrate: v3 starts empty,
///   new deposits go to v3, and v2 is wound down. No migration contract, no snapshot, no airdrop.
///
///   0. Preconditions. Owner 0x9471A4ea01f51d01749D9E9696b973faf27a96AE (cold EOA, owner of every v2
///      pool, adapter and the oracle) holds a little OKB for ~50 txs (~65 with V3_STABLE). Run the
///      fork test first:  XLAYER_MAINNET_RPC=https://rpc.xlayer.tech forge test --match-contract DeployV3Fork -vv
///   1. Pause v2 deposits (owner, optional but recommended, reversible). `pause()` on each affected
///      v2 pool stops new money landing in the vulnerable bytecode. It does NOT block exits (AumoPool
///      redemptions never pause; EquityPool exits only need the market open) and the agent can still
///      `deallocate` while paused.
///   2. Dry run (no --broadcast) and read the log: every v2 -> v3 address pair and the cloned config.
///      The run reverts in simulation if any v2 wiring check or v3-vs-v2 parity check fails.
///   3. Broadcast (command below). Deploys v3 pools + adapters, allowlists the adapters in v2 order,
///      applies policy, budgets, levy and agent, and mirrors the v2 pause state (or pauses everything
///      with V3_START_PAUSED=true). Owner stays 0x9471 (constructor), agent stays the v2 agent
///      0x2647904345d00Ef30d831935b913E5df1D58af67. No ownership transfer happens.
///   4. Verify on the explorer (--verify in the same command, or re-run `forge script ... --resume
///      --verify`). Then spot-check on-chain: owner(), agent(), paused(), venueAllowed(adapter),
///      MAX_EXIT_SHORTFALL_BPS() == 500 on each new pool.
///   5. Point the agent at v3 (Railway variables, then restart):
///        EQUITY_POOLS / EQUITY_VENUES       -> v3 stock pools + adapters, same order as EQUITY_SYMBOLS
///                                              (include the gold pair if PAXGY is in EQUITY_SYMBOLS)
///        EQUITY_BASKET_POOL / EQUITY_BASKET_VENUES -> v3 basket pool + its 4 adapters (NVDA,AAPL,MSFT,META)
///        V3_STABLE only: VAULT_ADDRESS -> v3 stable pool; agent/config/venues.mainnet.json `address`
///                        fields -> the 5 v3 stable adapters; Turnkey policy `eth.tx.to` -> v3 pool
///                        (agent/scripts/turnkey-create-policy.ts with AUMO_POOL=<v3 pool>)
///      The oracle feeder (SELF_HOSTED_EQUITY_ORACLE, updater 0x2647) is unchanged.
///   6. Point the web app at v3 and redeploy it:
///        web/lib/chain.ts  STOCKS_BY_NET.mainnet[*].pool, BASKET_BY_NET.mainnet.pool + members[*].venue,
///                          GOLD_BY_NET.mainnet.pool + .adapter
///        V3_STABLE only:   ADDR.mainnet.pool + .zap (or env NEXT_PUBLIC_POOL / NEXT_PUBLIC_ZAP),
///                          integrations/defillama/index.js POOL
///        Docs that list addresses: README.md, web/app/(content)/internals/page.tsx, STOCKS-VENUES.md.
///   7. Wind down v2: during market hours the agent `deallocate`s any v2 venue balance back to idle,
///      so any remaining v2 holder redeems from idle without touching a venue (the bug cannot fire).
///      Leave v2 paused; it stays owned and readable. Seed each v3 pool with a small deposit and run
///      one agent cycle before announcing.
///
///   ROLLBACK: nothing here moves funds or touches v2 config other than the optional pause. To roll
///   back, `unpause()` the v2 pools and revert the agent env / web config to the v2 addresses (git
///   revert of the config commit + Railway variable rollback). Pause the v3 pools if they took
///   deposits; holders can still exit them. Redeploying again is just re-running this script.
///
/// ===================================================================================================
/// BROADCAST COMMAND (run by the owner; the key never leaves the signer)
/// ===================================================================================================
///   cd contracts
///   forge script script/DeployV3Mainnet.s.sol:DeployV3Mainnet \
///     --rpc-url "$XLAYER_RPC_URL" \
///     --ledger --sender 0x9471A4ea01f51d01749D9E9696b973faf27a96AE \
///     --broadcast --slow \
///     --verify --verifier oklink \
///     --verifier-url https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER \
///     --verifier-api-key "$OKLINK_API_KEY"
///   (Keystore instead of Ledger: replace `--ledger` with `--account <keystore-name>`. Add
///   V3_STABLE=true in front to include the stable family; V3_STOCKS/V3_BASKET/V3_GOLD=false to skip
///   a family. Drop `--broadcast --verify ...` for the dry run in step 2.)
///
/// ENV (all optional; defaults are the live v2 deployment)
///   V3_OWNER            0x9471A4ea01f51d01749D9E9696b973faf27a96AE  must equal every v2 owner and the broadcaster
///   V3_STOCKS           true   clone the 4 single-stock pools
///   V3_BASKET           true   clone the basket pool
///   V3_GOLD             true   clone the gold pool
///   V3_STABLE           false  clone the stable pool, its 5 adapters and the zap
///   V3_START_PAUSED     false  pause every v3 pool at the end (unpause from the owner after checks)
///   V2_STOCK_POOLS      comma list, default NVDA,AAPL,MSFT,META pools above
///   V2_STOCK_ADAPTERS   comma list aligned with V2_STOCK_POOLS
///   V2_BASKET_POOL      0xFe01b81F5D22Ac3647424904f7DC7ecC9EA0358d
///   V2_BASKET_ADAPTERS  comma list, default the 4 basket adapters above (v2 allowlist order)
///   V2_GOLD_POOL        0xf1833C4eAEb42df6D9eE33ea090055cf690cee56
///   V2_GOLD_ADAPTER     0x6c3Dca1AA96010683bB0e7A0AEb80AbC2e4c25bF
///   V2_STABLE_POOL      0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F
///   V2_STABLE_AAVE      0x9c7Bb0972D0480335Ba1A9041D57d883d96BED1A
///   V2_STABLE_USDG      0x468c8106deDe0853E8746D488C999c2940725B3d
///   V2_STABLE_PENDLE    0x127644F456Fc63C7226E7f4F2Ce4F169A1165C65
///   V2_STABLE_LP        0x483aC413349951b34bFC9a8f0311A70F35e80F38
///   V2_STABLE_SPUSDT    0xd14f133D2ad6a7CF32cdaB5166eC95d58048fC10
///   V2_ZAP              0x29C9D4e86E587F42dadDa0b8004181EFE2D8B3df
///
/// Current v2 configuration this clones (read on-chain 2026-10-03, for reference only; the script
/// reads the live values at run time):
///   all pools: asset USDT0 0x779Ded0c9e1022225f8E0630b35a9b54bE713736, owner 0x9471.., agent 0x2647..,
///              unpaused, no pending owner
///   stocks:    maxMove 1,000e6  perVenue 50,000e6  maxTotal 50,000e6  deploy 50,000e6/1d
///              loss 0/1d  levy 25/50 bps  clock = own feed, maxAge 300s
///   basket:    maxMove 1,000e6  perVenue 20,000e6  maxTotal 50,000e6  deploy 50,000e6/1d
///              loss 0/1d  levy 25/50 bps  clock = NVDA, maxAge 300s
///   gold:      maxMove 1,000e6  perVenue 20,000e6  maxTotal 20,000e6  deploy 20,000e6/1d
///              loss 0/1d  levy 25/50 bps  clock = PAXGY, maxAge 300s
///   equity adapters: oracle 0x1759.., router 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA, maxAge 300,
///              slippage 200, path USDT0 -100- USDG -500- w<SYM>x / PAXGy (and mirror)
///   stable:    maxMove 100e6  perVenue 500e6  maxTotal 1,000e6  loss 10e6/1d  deploy 2,000e6/1d
///              levy n/a (v2 predates it; v3 keeps 0/0)
///              USDG adapter slippage 200 / valuation 30, Pendle 200/100/50 twap 900 staleness 3600,
///              LP 200/50, adapter owner 0x9471..
contract DeployV3Mainnet is Script {
    uint256 internal constant XLAYER_CHAIN_ID = 196;

    // ------------------------------------------------------------------ live v2 defaults
    address internal constant OWNER = 0x9471A4ea01f51d01749D9E9696b973faf27a96AE;

    address internal constant V2_NVDA_POOL = 0x9781cD1f02045c072D7D1915a215c9E46b49E1dB;
    address internal constant V2_NVDA_ADAPTER = 0xde65eF11e35942c7E706069dc8e9Cd1bC728B616;
    address internal constant V2_AAPL_POOL = 0xDcd9c0C948ebb4D63d88FA5EC8eDE571eF1BE523;
    address internal constant V2_AAPL_ADAPTER = 0xefeDCbe15Ab9C07d6105309B70dF8357a019B4Ef;
    address internal constant V2_MSFT_POOL = 0xbe0A87F49F424D3170804e29E5969a379Fe65626;
    address internal constant V2_MSFT_ADAPTER = 0xaeBBABB609C411dca95C11885CFf3749356c4aD0;
    address internal constant V2_META_POOL = 0x47343D8a880c84aD1a6aD679FEdd0DC23fdA8BcC;
    address internal constant V2_META_ADAPTER = 0xb51C025146B7d4542a2515B544d4F853Aa713A82;

    address internal constant V2_BASKET_POOL = 0xFe01b81F5D22Ac3647424904f7DC7ecC9EA0358d;
    address internal constant V2_BASKET_NVDA = 0xfdf7eb2a1A4F734901efB03a6a026dBb17B1A3dC;
    address internal constant V2_BASKET_AAPL = 0x479e1A2B6A2B70599a3Ef3e89334cb2dcAf43f63;
    address internal constant V2_BASKET_MSFT = 0x5908B1143d69f363FEEc8bBc41cb73Ff26C8de40;
    address internal constant V2_BASKET_META = 0xFC0F4b0C9C0CF785f822079EbFb789Dbeb7DdF49;

    address internal constant V2_GOLD_POOL = 0xf1833C4eAEb42df6D9eE33ea090055cf690cee56;
    address internal constant V2_GOLD_ADAPTER = 0x6c3Dca1AA96010683bB0e7A0AEb80AbC2e4c25bF;

    address internal constant V2_STABLE_POOL = 0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F;
    address internal constant V2_STABLE_AAVE = 0x9c7Bb0972D0480335Ba1A9041D57d883d96BED1A;
    address internal constant V2_STABLE_USDG = 0x468c8106deDe0853E8746D488C999c2940725B3d;
    address internal constant V2_STABLE_PENDLE = 0x127644F456Fc63C7226E7f4F2Ce4F169A1165C65;
    address internal constant V2_STABLE_LP = 0x483aC413349951b34bFC9a8f0311A70F35e80F38;
    address internal constant V2_STABLE_SPUSDT = 0xd14f133D2ad6a7CF32cdaB5166eC95d58048fC10;
    address internal constant V2_ZAP = 0x29C9D4e86E587F42dadDa0b8004181EFE2D8B3df;

    // Storage slot of AumoPool's private `_venues` array in each v2 layout (forge inspect
    // storageLayout): 26 for the equity pools (cb2e41c), 24 for the stable pool (b95ed0b, which
    // predates the levy fields). Used to prove the adapter lists below are the WHOLE v2 allowlist,
    // in order, so no venue is silently dropped by the clone.
    uint256 internal constant V2_EQUITY_VENUES_SLOT = 26;
    uint256 internal constant V2_STABLE_VENUES_SLOT = 24;

    // Constructor defaults of the fixed source; a v2 value equal to these needs no setter call.
    uint256 internal constant DEFAULT_EPOCH = 1 days;
    uint256 internal constant DEFAULT_PENDLE_STALENESS = 1 hours;

    // ------------------------------------------------------------------ types

    struct Plan {
        address owner;
        bool stocks;
        bool basket;
        bool gold;
        bool stable;
        bool startPaused;
        address[] stockPools;
        address[] stockAdapters;
        address basketPool;
        address[] basketAdapters;
        address goldPool;
        address goldAdapter;
        address stablePool;
        address stableAave;
        address stableUsdg;
        address stablePendle;
        address stableLp;
        address stableSpUsdt;
        address zap;
    }

    /// @dev Every owner-settable pool parameter, as read from a pool.
    struct Policy {
        address asset;
        address owner;
        address agent;
        bool paused;
        uint256 maxMoveSize;
        uint256 perVenueCap;
        uint256 maxTotalDeployed;
        uint256 maxEpochLoss;
        uint256 lossEpochLength;
        uint256 maxEpochDeploy;
        uint256 deployEpochLength;
        uint256 entryFeeBps;
        uint256 exitFeeBps;
    }

    struct Clock {
        address oracle;
        bytes32 feedId;
        uint256 maxAge;
    }

    /// @dev EquityAdapter constructor arguments (all public on the adapter), minus the vault.
    struct EquityVenue {
        address token;
        address stock;
        address oracle;
        bytes32 feedId;
        address router;
        bytes buyPath;
        bytes sellPath;
        uint256 maxAge;
        uint256 slippageBps;
    }

    struct EquitySnapshot {
        address v2Pool;
        address[] v2Adapters;
        Policy policy;
        Clock clock;
        EquityVenue[] venues;
    }

    struct AaveArgs {
        address token;
        address pool;
        address aToken;
    }

    struct UsdgArgs {
        address token;
        address usdg;
        address aUsdg;
        address pool;
        address router;
        address owner;
        uint24 poolFee;
        uint256 maxSlippageBps;
        uint256 valuationDiscountBps;
    }

    struct PendleArgs {
        address token;
        address usdg;
        address market;
        address router;
        address ptOracle;
        address uniRouter;
        address owner;
        uint24 uniPoolFee;
        uint256 uniSlippageBps;
        uint256 pendleSlippageBps;
        uint256 valuationDiscountBps;
        uint32 twapDuration;
        uint256 maxRateStaleness;
    }

    struct LpArgs {
        address token;
        address usdg;
        address pool;
        address router;
        address owner;
        uint24 poolFee;
        uint256 maxSlippageBps;
        uint256 valuationDiscountBps;
    }

    struct SpArgs {
        address token;
        address venue;
    }

    struct StableSnapshot {
        address v2Pool;
        Policy policy;
        AaveArgs aave;
        UsdgArgs usdg;
        PendleArgs pendle;
        LpArgs lp;
        SpArgs sp;
        address zapRouter;
    }

    struct EquityDeployment {
        address v2Pool;
        address pool;
        address[] adapters;
    }

    struct StableDeployment {
        address v2Pool;
        address pool;
        address aave;
        address usdg;
        address pendle;
        address lp;
        address spUsdt;
        address zap;
    }

    struct Deployment {
        EquityDeployment[] stocks;
        EquityDeployment basket;
        EquityDeployment gold;
        StableDeployment stable;
    }

    // ------------------------------------------------------------------ entry point

    function run() external returns (Deployment memory d) {
        require(block.chainid == XLAYER_CHAIN_ID, "not X Layer mainnet");
        Plan memory p = planFromEnv();
        require(msg.sender == p.owner, "broadcaster must be V3_OWNER (pass --sender <owner> with its signer)");
        d = execute(p);
        _logDeployment(p, d);
    }

    /// @notice The plan from env, defaulting to the live v2 deployment.
    function planFromEnv() public view returns (Plan memory p) {
        p.owner = vm.envOr("V3_OWNER", OWNER);
        p.stocks = vm.envOr("V3_STOCKS", true);
        p.basket = vm.envOr("V3_BASKET", true);
        p.gold = vm.envOr("V3_GOLD", true);
        p.stable = vm.envOr("V3_STABLE", false);
        p.startPaused = vm.envOr("V3_START_PAUSED", false);

        address[] memory defPools = new address[](4);
        defPools[0] = V2_NVDA_POOL;
        defPools[1] = V2_AAPL_POOL;
        defPools[2] = V2_MSFT_POOL;
        defPools[3] = V2_META_POOL;
        address[] memory defAdapters = new address[](4);
        defAdapters[0] = V2_NVDA_ADAPTER;
        defAdapters[1] = V2_AAPL_ADAPTER;
        defAdapters[2] = V2_MSFT_ADAPTER;
        defAdapters[3] = V2_META_ADAPTER;
        p.stockPools = vm.envOr("V2_STOCK_POOLS", ",", defPools);
        p.stockAdapters = vm.envOr("V2_STOCK_ADAPTERS", ",", defAdapters);

        address[] memory defBasket = new address[](4);
        defBasket[0] = V2_BASKET_NVDA;
        defBasket[1] = V2_BASKET_AAPL;
        defBasket[2] = V2_BASKET_MSFT;
        defBasket[3] = V2_BASKET_META;
        p.basketPool = vm.envOr("V2_BASKET_POOL", V2_BASKET_POOL);
        p.basketAdapters = vm.envOr("V2_BASKET_ADAPTERS", ",", defBasket);

        p.goldPool = vm.envOr("V2_GOLD_POOL", V2_GOLD_POOL);
        p.goldAdapter = vm.envOr("V2_GOLD_ADAPTER", V2_GOLD_ADAPTER);

        p.stablePool = vm.envOr("V2_STABLE_POOL", V2_STABLE_POOL);
        p.stableAave = vm.envOr("V2_STABLE_AAVE", V2_STABLE_AAVE);
        p.stableUsdg = vm.envOr("V2_STABLE_USDG", V2_STABLE_USDG);
        p.stablePendle = vm.envOr("V2_STABLE_PENDLE", V2_STABLE_PENDLE);
        p.stableLp = vm.envOr("V2_STABLE_LP", V2_STABLE_LP);
        p.stableSpUsdt = vm.envOr("V2_STABLE_SPUSDT", V2_STABLE_SPUSDT);
        p.zap = vm.envOr("V2_ZAP", V2_ZAP);
    }

    /// @notice Snapshot + check every selected v2 family, deploy the v3 clones from `p.owner`, then
    ///         re-read both generations and revert unless every parameter matches.
    function execute(Plan memory p) public returns (Deployment memory d) {
        require(p.stockPools.length == p.stockAdapters.length, "V2_STOCK_POOLS/ADAPTERS length mismatch");

        // 1) Read + check everything BEFORE broadcasting, so a wiring surprise costs no gas.
        EquitySnapshot[] memory stockSnaps = new EquitySnapshot[](p.stocks ? p.stockPools.length : 0);
        for (uint256 i; i < stockSnaps.length; ++i) {
            address[] memory one = new address[](1);
            one[0] = p.stockAdapters[i];
            stockSnaps[i] = _snapshotEquity(p.owner, p.stockPools[i], one);
        }
        EquitySnapshot memory basketSnap;
        if (p.basket) basketSnap = _snapshotEquity(p.owner, p.basketPool, p.basketAdapters);
        EquitySnapshot memory goldSnap;
        if (p.gold) {
            address[] memory one = new address[](1);
            one[0] = p.goldAdapter;
            goldSnap = _snapshotEquity(p.owner, p.goldPool, one);
        }
        StableSnapshot memory stableSnap;
        if (p.stable) stableSnap = _snapshotStable(p);

        // 2) Deploy + configure, every call sent from the owner.
        vm.startBroadcast(p.owner);
        d.stocks = new EquityDeployment[](stockSnaps.length);
        for (uint256 i; i < stockSnaps.length; ++i) {
            d.stocks[i] = _deployEquity(p, stockSnaps[i]);
        }
        if (p.basket) d.basket = _deployEquity(p, basketSnap);
        if (p.gold) d.gold = _deployEquity(p, goldSnap);
        if (p.stable) d.stable = _deployStable(p, stableSnap);
        vm.stopBroadcast();

        // 3) Parity: v3 must equal v2 on every parameter (reverts the run otherwise).
        verifyAgainstV2(p, d);
    }

    // ------------------------------------------------------------------ snapshot (reads only)

    function _readPolicy(address pool, bool hasLevy) internal view returns (Policy memory pol) {
        AumoPool v = AumoPool(pool);
        pol.asset = v.asset();
        pol.owner = v.owner();
        pol.agent = v.agent();
        pol.paused = v.paused();
        pol.maxMoveSize = v.maxMoveSize();
        pol.perVenueCap = v.perVenueCap();
        pol.maxTotalDeployed = v.maxTotalDeployed();
        pol.maxEpochLoss = v.maxEpochLoss();
        pol.lossEpochLength = v.lossEpochLength();
        pol.maxEpochDeploy = v.maxEpochDeploy();
        pol.deployEpochLength = v.deployEpochLength();
        if (hasLevy) {
            pol.entryFeeBps = v.entryFeeBps();
            pol.exitFeeBps = v.exitFeeBps();
        }
    }

    /// @dev The v2 stable pool predates the levy getters; probe instead of assuming.
    function _hasLevy(address pool) internal view returns (bool) {
        (bool ok, bytes memory ret) = pool.staticcall(abi.encodeWithSignature("entryFeeBps()"));
        return ok && ret.length == 32;
    }

    function _checkPoolCommon(address owner, address pool) internal view {
        require(pool.code.length > 0, "v2 pool has no code");
        require(AumoPool(pool).owner() == owner, "v2 pool owner != V3_OWNER");
        require(AumoPool(pool).pendingOwner() == address(0), "v2 pool has a pending ownership transfer");
    }

    function _checkVenue(address pool, address adapter) internal view {
        require(adapter.code.length > 0, "v2 adapter has no code");
        require(AumoPool(pool).venueAllowed(adapter), "v2 adapter not allowlisted on its pool");
        require(!AumoPool(pool).venueImpaired(adapter), "v2 adapter is impaired");
    }

    /// @dev Prove `expected` is exactly the v2 `_venues` array (allowlist history), in order.
    function _checkVenueList(address pool, uint256 slot, address[] memory expected) internal view {
        uint256 n = uint256(vm.load(pool, bytes32(slot)));
        require(n == expected.length, "v2 venue list length differs from the adapters given");
        uint256 base = uint256(keccak256(abi.encode(slot)));
        for (uint256 i; i < n; ++i) {
            address v = address(uint160(uint256(vm.load(pool, bytes32(base + i)))));
            require(v == expected[i], "v2 venue list differs from the adapters given (or order)");
        }
    }

    function _snapshotEquity(address owner, address v2Pool, address[] memory v2Adapters)
        internal
        view
        returns (EquitySnapshot memory s)
    {
        _checkPoolCommon(owner, v2Pool);
        _checkVenueList(v2Pool, V2_EQUITY_VENUES_SLOT, v2Adapters);
        s.v2Pool = v2Pool;
        s.v2Adapters = v2Adapters;
        s.policy = _readPolicy(v2Pool, true);
        EquityPool ep = EquityPool(v2Pool);
        s.clock = Clock(address(ep.marketOracle()), ep.marketFeedId(), ep.marketMaxAge());
        s.venues = new EquityVenue[](v2Adapters.length);
        for (uint256 i; i < v2Adapters.length; ++i) {
            _checkVenue(v2Pool, v2Adapters[i]);
            EquityAdapter a = EquityAdapter(v2Adapters[i]);
            require(a.vault() == v2Pool, "v2 equity adapter is bound to another pool");
            s.venues[i] = EquityVenue({
                token: address(a.token()),
                stock: address(a.stock()),
                oracle: address(a.oracle()),
                feedId: a.feedId(),
                router: address(a.router()),
                buyPath: a.buyPath(),
                sellPath: a.sellPath(),
                maxAge: a.maxAge(),
                slippageBps: a.slippageBps()
            });
        }
    }

    function _snapshotStable(Plan memory p) internal view returns (StableSnapshot memory s) {
        address v2 = p.stablePool;
        _checkPoolCommon(p.owner, v2);
        address[] memory list = new address[](5);
        list[0] = p.stableAave;
        list[1] = p.stableUsdg;
        list[2] = p.stablePendle;
        list[3] = p.stableLp;
        list[4] = p.stableSpUsdt;
        _checkVenueList(v2, V2_STABLE_VENUES_SLOT, list);
        for (uint256 i; i < 5; ++i) {
            _checkVenue(v2, list[i]);
            (bool ok, bytes memory ret) = list[i].staticcall(abi.encodeWithSignature("vault()"));
            require(ok && abi.decode(ret, (address)) == v2, "v2 stable adapter is bound to another pool");
        }
        s.v2Pool = v2;
        s.policy = _readPolicy(v2, _hasLevy(v2));

        AaveV3Adapter aave = AaveV3Adapter(p.stableAave);
        s.aave = AaveArgs(address(aave.token()), address(aave.pool()), address(aave.aToken()));

        RwaUsdgAdapter u = RwaUsdgAdapter(p.stableUsdg);
        s.usdg = UsdgArgs({
            token: address(u.token()),
            usdg: address(u.usdg()),
            aUsdg: address(u.aUsdg()),
            pool: address(u.pool()),
            router: address(u.router()),
            owner: u.owner(),
            poolFee: u.poolFee(),
            maxSlippageBps: u.maxSlippageBps(),
            valuationDiscountBps: u.valuationDiscountBps()
        });

        PendlePtAdapter pe = PendlePtAdapter(p.stablePendle);
        s.pendle = PendleArgs({
            token: address(pe.token()),
            usdg: address(pe.usdg()),
            market: pe.market(),
            router: address(pe.router()),
            ptOracle: address(pe.ptOracle()),
            uniRouter: address(pe.uniRouter()),
            owner: pe.owner(),
            uniPoolFee: pe.uniPoolFee(),
            uniSlippageBps: pe.uniSlippageBps(),
            pendleSlippageBps: pe.pendleSlippageBps(),
            valuationDiscountBps: pe.valuationDiscountBps(),
            twapDuration: pe.twapDuration(),
            maxRateStaleness: pe.maxRateStaleness()
        });

        UniV3LpAdapter lp = UniV3LpAdapter(p.stableLp);
        s.lp = LpArgs({
            token: address(lp.token()),
            usdg: address(lp.usdg()),
            pool: address(lp.pool()),
            router: address(lp.router()),
            owner: lp.owner(),
            poolFee: lp.poolFee(),
            maxSlippageBps: lp.maxSlippageBps(),
            valuationDiscountBps: lp.valuationDiscountBps()
        });

        Erc4626Adapter sp = Erc4626Adapter(p.stableSpUsdt);
        s.sp = SpArgs(address(sp.token()), address(sp.venue()));

        ZapDeposit zap = ZapDeposit(p.zap);
        require(address(zap.pool()) == v2, "v2 zap points at another pool");
        s.zapRouter = address(zap.router());

        // Adapter tunables can only be mirrored if the broadcaster owns the adapter.
        if (s.pendle.maxRateStaleness != DEFAULT_PENDLE_STALENESS) {
            require(s.pendle.owner == p.owner, "Pendle adapter owner != V3_OWNER; cannot mirror maxRateStaleness");
        }
    }

    // ------------------------------------------------------------------ deploy (broadcast)

    function _deployEquity(Plan memory p, EquitySnapshot memory s) internal returns (EquityDeployment memory out) {
        EquityPool pool = new EquityPool(IERC20(s.policy.asset), p.owner, s.clock.oracle, s.clock.feedId, s.clock.maxAge);
        out.v2Pool = s.v2Pool;
        out.pool = address(pool);
        out.adapters = new address[](s.venues.length);
        for (uint256 i; i < s.venues.length; ++i) {
            EquityVenue memory v = s.venues[i];
            EquityAdapter a = new EquityAdapter(
                v.token, v.stock, v.oracle, v.feedId, v.router, address(pool), v.buyPath, v.sellPath, v.maxAge, v.slippageBps
            );
            pool.setVenueAllowed(address(a), true);
            out.adapters[i] = address(a);
        }
        _applyPolicy(AumoPool(address(pool)), s.policy, p.startPaused);
    }

    function _deployStable(Plan memory p, StableSnapshot memory s) internal returns (StableDeployment memory out) {
        AumoPool pool = new AumoPool(IERC20(s.policy.asset), p.owner);
        out.v2Pool = s.v2Pool;
        out.pool = address(pool);

        out.aave = address(new AaveV3Adapter(s.aave.token, s.aave.pool, s.aave.aToken, address(pool)));
        out.usdg = address(
            new RwaUsdgAdapter(
                s.usdg.token,
                s.usdg.usdg,
                s.usdg.aUsdg,
                s.usdg.pool,
                s.usdg.router,
                address(pool),
                s.usdg.owner,
                s.usdg.poolFee,
                s.usdg.maxSlippageBps,
                s.usdg.valuationDiscountBps
            )
        );
        PendlePtAdapter pendle = new PendlePtAdapter(
            s.pendle.token,
            s.pendle.usdg,
            s.pendle.market,
            s.pendle.router,
            s.pendle.ptOracle,
            s.pendle.uniRouter,
            address(pool),
            s.pendle.owner,
            s.pendle.uniPoolFee,
            s.pendle.uniSlippageBps,
            s.pendle.pendleSlippageBps,
            s.pendle.valuationDiscountBps,
            s.pendle.twapDuration
        );
        if (s.pendle.maxRateStaleness != DEFAULT_PENDLE_STALENESS) {
            pendle.setMaxRateStaleness(s.pendle.maxRateStaleness);
        }
        out.pendle = address(pendle);
        out.lp = address(
            new UniV3LpAdapter(
                s.lp.token,
                s.lp.usdg,
                s.lp.pool,
                s.lp.router,
                address(pool),
                s.lp.owner,
                s.lp.poolFee,
                s.lp.maxSlippageBps,
                s.lp.valuationDiscountBps
            )
        );
        out.spUsdt = address(new Erc4626Adapter(s.sp.token, s.sp.venue, address(pool)));

        // Same allowlist order as v2 (it is also the redemption sweep order in _ensureIdle).
        pool.setVenueAllowed(out.aave, true);
        pool.setVenueAllowed(out.usdg, true);
        pool.setVenueAllowed(out.pendle, true);
        pool.setVenueAllowed(out.lp, true);
        pool.setVenueAllowed(out.spUsdt, true);
        _applyPolicy(pool, s.policy, p.startPaused);

        out.zap = address(new ZapDeposit(address(pool), s.zapRouter));
    }

    /// @dev Re-apply the v2 policy. Setters whose v2 value equals the constructor default are skipped
    ///      (fewer txs, same end state). The agent is set last; pause mirrors v2 unless startPaused.
    function _applyPolicy(AumoPool pool, Policy memory pol, bool startPaused) internal {
        pool.setPolicy(pol.maxMoveSize, pol.perVenueCap, pol.maxTotalDeployed);
        if (pol.maxEpochLoss != 0 || pol.lossEpochLength != DEFAULT_EPOCH) {
            pool.setLossBudget(pol.maxEpochLoss, pol.lossEpochLength);
        }
        if (pol.maxEpochDeploy != 0 || pol.deployEpochLength != DEFAULT_EPOCH) {
            pool.setDeployBudget(pol.maxEpochDeploy, pol.deployEpochLength);
        }
        if (pol.entryFeeBps != 0 || pol.exitFeeBps != 0) {
            pool.setFees(pol.entryFeeBps, pol.exitFeeBps);
        }
        if (pol.agent != pool.agent()) pool.setAgent(pol.agent);
        if (pol.paused || startPaused) pool.pause();
    }

    // ------------------------------------------------------------------ parity check

    /// @notice Revert unless every v3 contract carries exactly the v2 configuration it was cloned
    ///         from (pause state aside when V3_START_PAUSED), and carries the shortfall fix.
    function verifyAgainstV2(Plan memory p, Deployment memory d) public view {
        for (uint256 i; i < d.stocks.length; ++i) {
            _verifyEquity(p, d.stocks[i]);
        }
        if (p.basket) _verifyEquity(p, d.basket);
        if (p.gold) _verifyEquity(p, d.gold);
        if (p.stable) _verifyStable(p, d.stable);
    }

    function _verifyPolicy(Plan memory p, address v2, address v3, bool v2HasLevy) internal view {
        Policy memory a = _readPolicy(v2, v2HasLevy);
        Policy memory b = _readPolicy(v3, true);
        require(AumoPool(v3).MAX_EXIT_SHORTFALL_BPS() == 500, "v3 pool lacks the shortfall guard");
        require(b.asset == a.asset, "parity: asset");
        require(b.owner == a.owner && b.owner == p.owner, "parity: owner");
        require(AumoPool(v3).pendingOwner() == address(0), "parity: pending owner");
        require(b.agent == a.agent, "parity: agent");
        require(b.paused == (a.paused || p.startPaused), "parity: paused");
        require(b.maxMoveSize == a.maxMoveSize, "parity: maxMoveSize");
        require(b.perVenueCap == a.perVenueCap, "parity: perVenueCap");
        require(b.maxTotalDeployed == a.maxTotalDeployed, "parity: maxTotalDeployed");
        require(b.maxEpochLoss == a.maxEpochLoss, "parity: maxEpochLoss");
        require(b.lossEpochLength == a.lossEpochLength, "parity: lossEpochLength");
        require(b.maxEpochDeploy == a.maxEpochDeploy, "parity: maxEpochDeploy");
        require(b.deployEpochLength == a.deployEpochLength, "parity: deployEpochLength");
        require(b.entryFeeBps == a.entryFeeBps, "parity: entryFeeBps");
        require(b.exitFeeBps == a.exitFeeBps, "parity: exitFeeBps");
        require(
            keccak256(bytes(AumoPool(v3).name())) == keccak256(bytes(AumoPool(v2).name()))
                && keccak256(bytes(AumoPool(v3).symbol())) == keccak256(bytes(AumoPool(v2).symbol())),
            "parity: name/symbol"
        );
    }

    function _verifyEquity(Plan memory p, EquityDeployment memory e) internal view {
        _verifyPolicy(p, e.v2Pool, e.pool, true);
        EquityPool a = EquityPool(e.v2Pool);
        EquityPool b = EquityPool(e.pool);
        require(address(b.marketOracle()) == address(a.marketOracle()), "parity: marketOracle");
        require(b.marketFeedId() == a.marketFeedId(), "parity: marketFeedId");
        require(b.marketMaxAge() == a.marketMaxAge(), "parity: marketMaxAge");
        _checkVenueList(e.pool, V2_EQUITY_VENUES_SLOT, e.adapters); // v3 layout == v2 equity layout
        for (uint256 i; i < e.adapters.length; ++i) {
            require(b.venueAllowed(e.adapters[i]) && !b.venueImpaired(e.adapters[i]), "parity: venue allowlist");
            _verifyEquityAdapter(e.pool, e.adapters[i], _v2EquityAdapter(p, e.v2Pool, i));
        }
    }

    function _v2EquityAdapter(Plan memory p, address v2Pool, uint256 i) internal pure returns (address) {
        if (v2Pool == p.basketPool) return p.basketAdapters[i];
        if (v2Pool == p.goldPool) return p.goldAdapter;
        for (uint256 k; k < p.stockPools.length; ++k) {
            if (p.stockPools[k] == v2Pool) return p.stockAdapters[k];
        }
        revert("unknown v2 pool");
    }

    function _verifyEquityAdapter(address v3Pool, address n, address o) internal view {
        EquityAdapter x = EquityAdapter(o);
        EquityAdapter y = EquityAdapter(n);
        require(y.vault() == v3Pool, "parity: adapter vault");
        require(address(y.token()) == address(x.token()), "parity: adapter token");
        require(address(y.stock()) == address(x.stock()), "parity: adapter stock");
        require(address(y.oracle()) == address(x.oracle()), "parity: adapter oracle");
        require(y.feedId() == x.feedId(), "parity: adapter feedId");
        require(address(y.router()) == address(x.router()), "parity: adapter router");
        require(keccak256(y.buyPath()) == keccak256(x.buyPath()), "parity: adapter buyPath");
        require(keccak256(y.sellPath()) == keccak256(x.sellPath()), "parity: adapter sellPath");
        require(y.maxAge() == x.maxAge(), "parity: adapter maxAge");
        require(y.slippageBps() == x.slippageBps(), "parity: adapter slippageBps");
    }

    function _verifyStable(Plan memory p, StableDeployment memory s) internal view {
        _verifyPolicy(p, s.v2Pool, s.pool, _hasLevy(s.v2Pool));
        address[] memory list = new address[](5);
        list[0] = s.aave;
        list[1] = s.usdg;
        list[2] = s.pendle;
        list[3] = s.lp;
        list[4] = s.spUsdt;
        _checkVenueList(s.pool, V2_EQUITY_VENUES_SLOT, list); // HEAD AumoPool layout: slot 26
        for (uint256 i; i < 5; ++i) {
            require(AumoPool(s.pool).venueAllowed(list[i]) && !AumoPool(s.pool).venueImpaired(list[i]), "parity: venue");
        }

        AaveV3Adapter a0 = AaveV3Adapter(p.stableAave);
        AaveV3Adapter a1 = AaveV3Adapter(s.aave);
        require(a1.vault() == s.pool, "parity: aave vault");
        require(
            address(a1.token()) == address(a0.token()) && address(a1.pool()) == address(a0.pool())
                && address(a1.aToken()) == address(a0.aToken()),
            "parity: aave args"
        );

        RwaUsdgAdapter u0 = RwaUsdgAdapter(p.stableUsdg);
        RwaUsdgAdapter u1 = RwaUsdgAdapter(s.usdg);
        require(u1.vault() == s.pool, "parity: usdg vault");
        require(
            address(u1.token()) == address(u0.token()) && address(u1.usdg()) == address(u0.usdg())
                && address(u1.aUsdg()) == address(u0.aUsdg()) && address(u1.pool()) == address(u0.pool())
                && address(u1.router()) == address(u0.router()) && u1.owner() == u0.owner()
                && u1.poolFee() == u0.poolFee() && u1.maxSlippageBps() == u0.maxSlippageBps()
                && u1.valuationDiscountBps() == u0.valuationDiscountBps(),
            "parity: usdg args"
        );

        PendlePtAdapter e0 = PendlePtAdapter(p.stablePendle);
        PendlePtAdapter e1 = PendlePtAdapter(s.pendle);
        require(e1.vault() == s.pool, "parity: pendle vault");
        require(
            address(e1.token()) == address(e0.token()) && address(e1.usdg()) == address(e0.usdg())
                && address(e1.pt()) == address(e0.pt()) && e1.yt() == e0.yt() && e1.market() == e0.market()
                && address(e1.router()) == address(e0.router()) && address(e1.ptOracle()) == address(e0.ptOracle())
                && address(e1.uniRouter()) == address(e0.uniRouter()) && e1.owner() == e0.owner(),
            "parity: pendle wiring"
        );
        require(
            e1.uniPoolFee() == e0.uniPoolFee() && e1.uniSlippageBps() == e0.uniSlippageBps()
                && e1.pendleSlippageBps() == e0.pendleSlippageBps()
                && e1.valuationDiscountBps() == e0.valuationDiscountBps() && e1.twapDuration() == e0.twapDuration()
                && e1.maxRateStaleness() == e0.maxRateStaleness(),
            "parity: pendle tunables"
        );

        UniV3LpAdapter l0 = UniV3LpAdapter(p.stableLp);
        UniV3LpAdapter l1 = UniV3LpAdapter(s.lp);
        require(l1.vault() == s.pool, "parity: lp vault");
        require(
            address(l1.token()) == address(l0.token()) && address(l1.usdg()) == address(l0.usdg())
                && address(l1.pool()) == address(l0.pool()) && address(l1.router()) == address(l0.router())
                && l1.owner() == l0.owner() && l1.poolFee() == l0.poolFee() && l1.usdgIsToken0() == l0.usdgIsToken0()
                && l1.maxSlippageBps() == l0.maxSlippageBps() && l1.valuationDiscountBps() == l0.valuationDiscountBps(),
            "parity: lp args"
        );

        Erc4626Adapter s0 = Erc4626Adapter(p.stableSpUsdt);
        Erc4626Adapter s1 = Erc4626Adapter(s.spUsdt);
        require(s1.vault() == s.pool, "parity: spUSDT vault");
        require(
            address(s1.token()) == address(s0.token()) && address(s1.venue()) == address(s0.venue()),
            "parity: spUSDT args"
        );

        ZapDeposit z0 = ZapDeposit(p.zap);
        ZapDeposit z1 = ZapDeposit(s.zap);
        require(address(z1.pool()) == s.pool, "parity: zap pool");
        require(
            address(z1.router()) == address(z0.router()) && address(z1.usdt0()) == address(z0.usdt0()),
            "parity: zap args"
        );
    }

    // ------------------------------------------------------------------ output

    function _logDeployment(Plan memory p, Deployment memory d) internal pure {
        console2.log("=== Aumo v3 redeploy (shortfall guard 9f7761e). owner:", p.owner);
        for (uint256 i; i < d.stocks.length; ++i) {
            _logEquity("stock", d.stocks[i]);
        }
        if (p.basket) _logEquity("basket", d.basket);
        if (p.gold) _logEquity("gold", d.gold);
        if (p.stable) {
            console2.log("--- stable  v2 pool:", d.stable.v2Pool);
            console2.log("            v3 pool:", d.stable.pool);
            console2.log("  aave   :", d.stable.aave);
            console2.log("  usdg   :", d.stable.usdg);
            console2.log("  pendle :", d.stable.pendle);
            console2.log("  lp     :", d.stable.lp);
            console2.log("  spUSDT :", d.stable.spUsdt);
            console2.log("  zap    :", d.stable.zap);
        }
        console2.log("Parity with v2 verified on-chain. Next: explorer verify, then agent + web config (see NatSpec).");
    }

    function _logEquity(string memory label, EquityDeployment memory e) internal pure {
        console2.log(string.concat("--- ", label, "  v2 pool:"), e.v2Pool);
        console2.log("            v3 pool:", e.pool);
        for (uint256 i; i < e.adapters.length; ++i) {
            console2.log("  v3 adapter:", e.adapters[i]);
        }
    }
}
