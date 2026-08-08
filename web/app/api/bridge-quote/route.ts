import { type NextRequest, NextResponse } from "next/server";
import { parseUnits, isAddress, type Address } from "viem";
import { quoteBridge } from "@/lib/bridge";

// Server-side so the mainnet RPC reads don't hit browser CORS.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const source = p.get("source") ?? "arbitrum";
  const amount = p.get("amount") ?? "100";
  const to = p.get("to");
  const recipient = (to && isAddress(to) ? to : "0x197ED5B2313fA482EC271861360E839A8eF75731") as Address;

  try {
    const units = parseUnits(amount, 6);
    if (units <= 0n) return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
    const quote = await quoteBridge(source, recipient, units);
    return NextResponse.json(quote);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "quote failed" }, { status: 500 });
  }
}
