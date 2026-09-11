import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseUnits,
  stringToHex,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mockOracleAbi, mockRouterAbi } from "./abi.js";
import { loadEquityConfig, type EquityConfig } from "./config.js";

/**
 * Testnet SOAK driver. During (approx) US equity market hours it publishes a fresh, random-walked
 * price to the MockEquityOracle and MockSwapRouter so the pool's NAV moves and the market-hours gate
 * reads OPEN; outside those hours (and on weekends) it publishes nothing, so the clock ages past the
 * pool's maxAge and the gate reads CLOSED — exactly the entry/exit freeze mainnet will see. This
 * exists ONLY to make the 3-day soak realistic; it drives mocks and HARD-REFUSES to run on mainnet.
 */

// Approximate NYSE regular session in UTC: 14:30–21:00, Mon–Fri. Ignores US DST (±1h) and holidays;
// good enough to exercise open/closed transitions and a full weekend freeze over a 3-day soak.
function marketOpenNow(d = new Date()): boolean {
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= 14 * 60 + 30 && mins < 21 * 60;
}

export async function equityFeed(cfg: EquityConfig): Promise<void> {
  if (cfg.chainId === 196) {
    throw new Error("feeder is a TESTNET-ONLY mock driver; refusing to run on X Layer mainnet (196)");
  }
  if (!cfg.oracle || !cfg.router) {
    throw new Error("feeder needs EQUITY_ORACLE and EQUITY_ROUTER (from the testnet deploy output)");
  }
  if (!cfg.agentPrivateKey) throw new Error("feeder needs AGENT_PRIVATE_KEY to publish prices");

  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.chainName,
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const account = privateKeyToAccount(cfg.agentPrivateKey);
  const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const feedId = stringToHex(cfg.feedId, { size: 32 });

  // Seed the walk from the last published price if there is one, else the configured base.
  let px = cfg.basePriceUsd;
  try {
    const [p] = (await pc.readContract({
      address: cfg.oracle,
      abi: mockOracleAbi,
      functionName: "priceWad",
      args: [feedId],
    })) as [bigint, bigint];
    if (p > 0n) px = Number(formatUnits(p, 18));
  } catch {
    // no prior price; start at base
  }

  console.log(
    `Aumo equity feeder (TESTNET) · oracle ${cfg.oracle} · router ${cfg.router} · ${cfg.feedId} ~ $${px.toFixed(
      2,
    )} · interval ${cfg.loopIntervalMs / 1000}s`,
  );

  const lo = cfg.basePriceUsd * 0.8;
  const hi = cfg.basePriceUsd * 1.2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (marketOpenNow()) {
        // ±0.5% random step, clamped to ±20% of base — a plausible intraday walk.
        const step = (Math.random() - 0.5) * 0.01;
        px = Math.min(hi, Math.max(lo, px * (1 + step)));
        const pxWad = parseUnits(px.toFixed(8), 18);
        const now = BigInt(Math.floor(Date.now() / 1000));
        const nonce = await pc.getTransactionCount({ address: account.address, blockTag: "pending" });
        const h1 = await wallet.writeContract({
          account,
          chain,
          nonce,
          address: cfg.oracle,
          abi: mockOracleAbi,
          functionName: "set",
          args: [feedId, pxWad, now],
        });
        await pc.waitForTransactionReceipt({ hash: h1 });
        const h2 = await wallet.writeContract({
          account,
          chain,
          nonce: nonce + 1,
          address: cfg.router,
          abi: mockRouterAbi,
          functionName: "setPrice",
          args: [pxWad],
        });
        await pc.waitForTransactionReceipt({ hash: h2 });
        console.log(`${new Date().toISOString()}  OPEN  ${cfg.feedId} $${px.toFixed(2)}  (clock fresh)`);
      } else {
        console.log(`${new Date().toISOString()}  CLOSED  holding — clock ages to stale, gate freezes`);
      }
    } catch (err) {
      console.error("feeder error:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, cfg.loopIntervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  equityFeed(loadEquityConfig()).catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
