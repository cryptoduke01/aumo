/**
 * Gold price source for the PAXGy feed. PAXGy (Paxos yield-bearing gold) has an on-chain rate in GOLD
 * terms (Accountant.getRate()), but NO on-chain PAXGy->USD on X Layer. So the feeder marks it as
 *   PAXGy/USD = getRate() (gold-oz per PAXGy) x gold/USD
 * and posts that to the self-hosted oracle under the PAXGY feed, exactly like a stock quote.
 *
 * The gold/USD number comes from PAX Gold (PAXG) spot — the exact asset PAXGy redeems into, so the mark
 * tracks the real underlying, not a loosely-correlated index. Both sources below are free, no API key.
 * Coingecko (PAXG) is primary; gold-api.com (XAU spot) is the fallback. We never price gold off the
 * PAXGy/USDG pool itself — that would be manipulable, the same reason NAV isn't marked at pool spot.
 */

const GOLD_MIN_USD = 500; // sanity band: reject an absurd gold print rather than mispricing the pool
const GOLD_MAX_USD = 20_000;

/** PAX Gold (≈ 1 fine troy oz) USD spot via Coingecko. */
async function fromCoingecko(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd",
    { method: "GET" },
  );
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const j = (await res.json()) as { "pax-gold"?: { usd?: number } };
  const p = Number(j?.["pax-gold"]?.usd);
  if (!Number.isFinite(p) || p <= 0) throw new Error("coingecko: no PAXG price");
  return p;
}

/** XAU (gold) USD spot via gold-api.com — fallback source. */
async function fromGoldApi(): Promise<number> {
  const res = await fetch("https://api.gold-api.com/price/XAU", { method: "GET" });
  if (!res.ok) throw new Error(`gold-api ${res.status}`);
  const j = (await res.json()) as { price?: number };
  const p = Number(j?.price);
  if (!Number.isFinite(p) || p <= 0) throw new Error("gold-api: no XAU price");
  return p;
}

/** Current gold (per fine troy oz) in USD, primary source with a fallback, bounded to a sane band. */
export async function fetchGoldUsd(): Promise<number> {
  let price: number;
  try {
    price = await fromCoingecko();
  } catch {
    price = await fromGoldApi(); // let this throw if the fallback also fails
  }
  if (price < GOLD_MIN_USD || price > GOLD_MAX_USD) {
    throw new Error(`gold price ${price} outside sane band [${GOLD_MIN_USD}, ${GOLD_MAX_USD}]`);
  }
  return price;
}

/**
 * PAXGy price in USD from the on-chain gold rate and a gold/USD spot. Pure + unit-tested.
 * @param goldUsd  gold per fine troy oz, USD
 * @param rateWad  Accountant.getRate() (PAXGy -> gold-oz, 1e18-scaled)
 */
export function paxgyPriceUsd(goldUsd: number, rateWad: bigint): number {
  if (goldUsd <= 0) throw new Error(`bad gold price ${goldUsd}`);
  const rate = Number(rateWad) / 1e18;
  // getRate is monotonic non-decreasing from 1.0 and capped at +0.04%/update; a value far off that band
  // means a bad read, so refuse rather than mispricing.
  if (!(rate >= 1 && rate < 1.2)) throw new Error(`getRate ${rate} outside sane band [1, 1.2)`);
  return goldUsd * rate;
}

/**
 * Gold trades ~24/5 (Sun 22:00 UTC through Fri 22:00 UTC), unlike US equities. Report REGULAR while the
 * metals market is open so the pool's gate allows entry/exit, and CLOSED over the weekend so no one
 * transacts across a weekend gold gap. Returns the oracle 24/5 status code (2 = REGULAR, 5 = CLOSED).
 */
export function goldMarketStatus(d = new Date()): number {
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  const h = d.getUTCHours();
  if (day === 6) return 5; // Saturday: closed
  if (day === 0 && h < 22) return 5; // Sunday before 22:00 UTC: closed
  if (day === 5 && h >= 22) return 5; // Friday after 22:00 UTC: closed
  return 2; // REGULAR
}
