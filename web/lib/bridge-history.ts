// Client-only record of bridge sends, so a user can see in-flight transfers across reloads.
// LayerZero delivery is asynchronous (often a few minutes, sometimes longer on newer paths), so a
// send that already succeeded on the source chain shows nothing on the destination yet. Without this
// the UI looked like the funds vanished ("Max 0"), which is exactly the wrong thing for a bridge.

export interface PendingBridge {
  hash: string;
  srcName: string;
  destName: string;
  amount: string;
  symbol: string;
  at: number; // ms epoch when sent
}

const KEY = "aumo-bridges";

export function getBridges(): PendingBridge[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(list: PendingBridge[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
  } catch {}
}

export function addBridge(b: PendingBridge) {
  save([b, ...getBridges().filter((x) => x.hash !== b.hash)]);
}

export function removeBridge(hash: string) {
  save(getBridges().filter((x) => x.hash !== hash));
}

// LayerZero scan REST API — CORS-open, so delivery status can be polled directly from the browser.
export type BridgeStatus = "pending" | "delivered" | "failed";

export async function fetchBridgeStatus(hash: string, signal?: AbortSignal): Promise<BridgeStatus> {
  try {
    const r = await fetch(`https://scan.layerzero-api.com/v1/messages/tx/${hash}`, { signal });
    if (!r.ok) return "pending";
    const d = await r.json();
    const name: string | undefined = d?.data?.[0]?.status?.name;
    if (name === "DELIVERED") return "delivered";
    if (name === "FAILED" || name === "BLOCKED") return "failed";
    return "pending";
  } catch {
    return "pending";
  }
}
