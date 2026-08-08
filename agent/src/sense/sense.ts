import type { PublicClient } from "viem";
import type { Config } from "../config.js";
import type { MarketSnapshot } from "../types.js";
import { readVaultState, readVenueState } from "../chain/vault.js";

/**
 * Sense: read the live on-chain vault state and join it with venue market data.
 * The on-chain reads (allowlist, principal, live balance, caps) are authoritative;
 * the market metrics come from the configured feed.
 */
export async function sense(pc: PublicClient, cfg: Config): Promise<MarketSnapshot> {
  const vault = await readVaultState(pc, cfg.vaultAddress);
  const venues = await Promise.all(
    cfg.venues.map((meta) => readVenueState(pc, cfg.vaultAddress, meta)),
  );
  return { vault, venues, takenAt: new Date().toISOString() };
}
