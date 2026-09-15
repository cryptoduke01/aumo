import { type NextRequest } from "next/server";

/**
 * Price history for a stock's chart modal. Proxies Yahoo Finance's public chart endpoint server-side
 * (no API key, and it keeps the browser off a third-party host), normalizes to a compact {t, c} series,
 * and caches briefly. The app passes the xStock symbol (e.g. "NVDAx"); the underlying ticker is that
 * minus the trailing wrapper letter ("NVDA").
 */
export const revalidate = 60;

const RANGES: Record<string, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const key = (searchParams.get("range") ?? "1D").toUpperCase();
  const r = RANGES[key] ?? RANGES["1D"]!;
  const ticker = symbol.endsWith("X") ? symbol.slice(0, -1) : symbol; // NVDAX -> NVDA
  if (!ticker) return Response.json({ error: "bad symbol" }, { status: 400 });

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${r.range}&interval=${r.interval}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return Response.json({ error: `upstream ${res.status}` }, { status: 502 });
    const j = (await res.json()) as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
    };
    const result = j.chart?.result?.[0];
    const ts = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const points = ts
      .map((t, i) => ({ t, c: closes[i] }))
      .filter((p): p is { t: number; c: number } => typeof p.c === "number" && Number.isFinite(p.c));
    if (points.length === 0) return Response.json({ error: "no data" }, { status: 404 });
    const first = points[0]!.c;
    const last = points[points.length - 1]!.c;
    return Response.json({
      ticker,
      range: key in RANGES ? key : "1D",
      points,
      first,
      last,
      changePct: first ? (last / first - 1) * 100 : 0,
    });
  } catch {
    return Response.json({ error: "fetch failed" }, { status: 502 });
  }
}
