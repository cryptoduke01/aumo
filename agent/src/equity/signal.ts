/**
 * Trend overlay for agent-managed equity pools (Option A). The depositor picks the stock; this decides
 * whether the pool should currently HOLD that stock ("in") or DE-RISK to idle USD₮0 ("out"), from a
 * deterministic, published rule over daily closes. No black box: a simple trend filter (price vs a
 * moving average) plus a drawdown cap, with a hysteresis band so it does not whipsaw around the line.
 *
 * Data is Yahoo Finance's public daily chart (no key, same source the app's candles route uses),
 * fetched server-side. If the series can't be read, the signal holds the CURRENT state rather than
 * acting blind — never de-risk or re-enter on missing data.
 */

export interface SignalParams {
  smaPeriod: number; // moving-average window in days
  bufferBps: number; // hysteresis half-band around the SMA, in bps of the SMA
  drawdownPct: number; // de-risk if drawdown from the recent high exceeds this (percent)
  lookback: number; // window (days) for the "recent high"
}

export const DEFAULT_SIGNAL: SignalParams = {
  smaPeriod: 20,
  bufferBps: 150, // 1.5%
  drawdownPct: 12,
  lookback: 20,
};

export interface TrendSignal {
  symbol: string;
  ok: boolean; // false when price data was unavailable (then target = current state)
  lastClose: number;
  sma: number;
  recentHigh: number;
  drawdownPct: number;
  target: "in" | "out";
  reason: string;
}

/** xStock ticker -> underlying US ticker (NVDAx -> NVDA), matching the app's candles proxy. */
function underlying(symbol: string): string {
  const up = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  return up.endsWith("X") ? up.slice(0, -1) : up;
}

async function fetchDailyCloses(symbol: string): Promise<number[]> {
  const ticker = underlying(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=3mo&interval=1d`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const j = (await res.json()) as {
    chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
  };
  const closes = j.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((c): c is number => typeof c === "number" && Number.isFinite(c));
}

/**
 * Compute the trend target for one stock. `currentlyIn` is whether the pool is holding the stock now;
 * it decides the target inside the hysteresis band (hold state) and on a data outage (hold state).
 */
export async function trendSignal(
  symbol: string,
  currentlyIn: boolean,
  p: SignalParams = DEFAULT_SIGNAL,
): Promise<TrendSignal> {
  let closes: number[];
  try {
    closes = await fetchDailyCloses(symbol);
  } catch (err) {
    return {
      symbol,
      ok: false,
      lastClose: 0,
      sma: 0,
      recentHigh: 0,
      drawdownPct: 0,
      target: currentlyIn ? "in" : "out",
      reason: `price data unavailable (${err instanceof Error ? err.message : "fetch failed"}) — holding current state`,
    };
  }

  if (closes.length < p.smaPeriod) {
    return {
      symbol,
      ok: false,
      lastClose: closes[closes.length - 1] ?? 0,
      sma: 0,
      recentHigh: 0,
      drawdownPct: 0,
      target: currentlyIn ? "in" : "out",
      reason: `not enough history (${closes.length} < ${p.smaPeriod}) — holding current state`,
    };
  }

  const lastClose = closes[closes.length - 1]!;
  const smaWindow = closes.slice(-p.smaPeriod);
  const sma = smaWindow.reduce((a, b) => a + b, 0) / smaWindow.length;
  const highWindow = closes.slice(-p.lookback);
  const recentHigh = Math.max(...highWindow);
  const drawdownPct = recentHigh > 0 ? ((recentHigh - lastClose) / recentHigh) * 100 : 0;

  const upper = sma * (1 + p.bufferBps / 10_000);
  const lower = sma * (1 - p.bufferBps / 10_000);

  let target: "in" | "out";
  let reason: string;
  if (drawdownPct > p.drawdownPct) {
    target = "out";
    reason = `drawdown ${drawdownPct.toFixed(1)}% > ${p.drawdownPct}% from ${p.lookback}d high — de-risk`;
  } else if (lastClose >= upper) {
    target = "in";
    reason = `close ${lastClose.toFixed(2)} above ${p.smaPeriod}d SMA ${sma.toFixed(2)} (+${(p.bufferBps / 100).toFixed(2)}% band) — participate`;
  } else if (lastClose < lower) {
    target = "out";
    reason = `close ${lastClose.toFixed(2)} below ${p.smaPeriod}d SMA ${sma.toFixed(2)} (-${(p.bufferBps / 100).toFixed(2)}% band) — de-risk`;
  } else {
    target = currentlyIn ? "in" : "out";
    reason = `close ${lastClose.toFixed(2)} inside SMA band [${lower.toFixed(2)}, ${upper.toFixed(2)}] — hold ${target}`;
  }

  return { symbol, ok: true, lastClose, sma, recentHigh, drawdownPct, target, reason };
}
