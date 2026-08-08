import type { Address, MarketSnapshot, Regime, RiskBand } from "../types.js";
import { BAND_RANK, scorePortfolio, type VenueRisk } from "../risk/engine.js";

export interface Move {
  venue: Address;
  venueName: string;
  action: "allocate" | "deallocate";
  amount: bigint; // asset units
  reasonTag: string; // short, written on-chain (<= 31 bytes)
  rationale: string; // full, stored off-chain in the receipt
  band: RiskBand;
  riskScore: number;
  riskAdjustedApyBps: number;
}

export interface Plan {
  regime: Regime;
  appetite: RiskBand;
  moves: Move[];
  idleBefore: bigint;
  idleAfter: bigint;
  totalDeployedAfter: bigint;
  risks: VenueRisk[];
  summary: string;
  source: "risk-engine" | "risk-engine+llm";
}

// A defensive regime deploys less of the idle balance; a calm one deploys it all.
const REGIME_DEPLOY_FRACTION: Record<Regime, number> = {
  calm: 1.0,
  cautious: 0.6,
  defensive: 0.25,
};

export interface PlanOpts {
  appetite: RiskBand;
  regime?: Regime;
  maxConcentration?: number; // 0..1 share of portfolio per venue
  deny?: Set<string>; // lowercased venue addresses to exclude from new deploys
}

/**
 * Build the deterministic plan. This is the safety-critical core: it can only
 * propose moves that already satisfy every on-chain guardrail, so the contract
 * never has to reject a well-formed plan. The LLM layer wraps this and may tighten
 * it (deny venues, choose a more defensive regime) but never loosen it.
 */
export function buildPlan(snap: MarketSnapshot, opts: PlanOpts): Plan {
  const { vault } = snap;
  const regime = opts.regime ?? "calm";
  const appetite = opts.appetite;
  const deny = opts.deny ?? new Set<string>();
  const maxConc = opts.maxConcentration ?? 0.6;
  const unit = 10 ** vault.decimals;
  const portfolioUnits = (Number(vault.idle) + Number(vault.totalDeployed)) / unit;

  const risks = scorePortfolio(snap.venues, vault.decimals, portfolioUnits);
  const riskByAddr = new Map(risks.map((r) => [r.address.toLowerCase(), r]));

  const moves: Move[] = [];

  // 1) Retreat first. Any venue we hold that is no longer allowlisted or whose risk
  //    band now exceeds appetite is fully unwound. Retreat is never blocked.
  for (const v of snap.venues) {
    const r = riskByAddr.get(v.address.toLowerCase());
    if (!r) continue;
    const outOfPolicy = !v.allowed || BAND_RANK[r.band] > BAND_RANK[appetite];
    if (v.allocatedPrincipal > 0n && outOfPolicy) {
      const amount = v.liveBalance > 0n ? v.liveBalance : v.allocatedPrincipal;
      moves.push({
        venue: v.address,
        venueName: v.name,
        action: "deallocate",
        amount,
        reasonTag: `retreat:${r.band}`.slice(0, 31),
        rationale: `Exit ${v.name}: ${
          !v.allowed
            ? "no longer allowlisted on-chain"
            : `risk band ${r.band} exceeds appetite ${appetite}`
        }.${r.notes.length ? " " + r.notes.join("; ") + "." : ""}`,
        band: r.band,
        riskScore: r.riskScore,
        riskAdjustedApyBps: r.riskAdjustedApyBps,
      });
    }
  }

  // 2) Deploy idle capital into eligible venues, best risk-adjusted yield first.
  const deployFrac = REGIME_DEPLOY_FRACTION[regime];
  const deployFracBps = BigInt(Math.round(deployFrac * 10000));
  let budget = (vault.idle * deployFracBps) / 10000n;
  const globalHeadroom =
    vault.maxTotalDeployed > vault.totalDeployed
      ? vault.maxTotalDeployed - vault.totalDeployed
      : 0n;
  if (budget > globalHeadroom) budget = globalHeadroom;

  const portfolioBig = vault.idle + vault.totalDeployed;
  const concCap = (portfolioBig * BigInt(Math.round(maxConc * 10000))) / 10000n;

  const eligible = snap.venues
    .filter((v) => v.allowed && !deny.has(v.address.toLowerCase()))
    .map((v) => ({ v, r: riskByAddr.get(v.address.toLowerCase())! }))
    .filter(({ r }) => r && BAND_RANK[r.band] <= BAND_RANK[appetite])
    .sort((a, b) => b.r.riskAdjustedApyBps - a.r.riskAdjustedApyBps);

  for (const { v, r } of eligible) {
    if (budget <= 0n) break;
    const already = v.allocatedPrincipal;
    const perVenueHeadroom = vault.perVenueCap > already ? vault.perVenueCap - already : 0n;
    const concHeadroom = concCap > already ? concCap - already : 0n;

    let size = budget;
    if (size > vault.maxMoveSize) size = vault.maxMoveSize;
    if (size > perVenueHeadroom) size = perVenueHeadroom;
    if (size > concHeadroom) size = concHeadroom;
    if (size <= 0n) continue;

    budget -= size;
    moves.push({
      venue: v.address,
      venueName: v.name,
      action: "allocate",
      amount: size,
      reasonTag: `${regime}|ra:${r.riskAdjustedApyBps}`.slice(0, 31),
      rationale: `Deploy into ${v.name} at ${(v.apyBps / 100).toFixed(2)}% APY, haircut to ${(
        r.riskAdjustedApyBps / 100
      ).toFixed(2)}% risk-adjusted (risk ${(r.riskScore * 100).toFixed(0)}/100, band ${
        r.band
      }). Sized to the ${(maxConc * 100).toFixed(
        0,
      )}% concentration cap and per-move limit under a ${regime} regime.`,
      band: r.band,
      riskScore: r.riskScore,
      riskAdjustedApyBps: r.riskAdjustedApyBps,
    });
  }

  // Projected balances (principal basis; ignores accrued yield on retreat).
  const allocSum = moves
    .filter((m) => m.action === "allocate")
    .reduce((a, m) => a + m.amount, 0n);
  const deallocPrincipal = moves
    .filter((m) => m.action === "deallocate")
    .reduce((a, m) => {
      const v = snap.venues.find((x) => x.address === m.venue);
      const principal = v?.allocatedPrincipal ?? 0n;
      return a + (m.amount > principal ? principal : m.amount);
    }, 0n);

  const idleAfter = vault.idle - allocSum + deallocPrincipal;
  const totalDeployedAfter = vault.totalDeployed + allocSum - deallocPrincipal;

  const nAlloc = moves.filter((m) => m.action === "allocate").length;
  const nRetreat = moves.filter((m) => m.action === "deallocate").length;
  const summary =
    moves.length === 0
      ? `Hold. No move improves the risk-adjusted position within a ${regime} regime and ${appetite} appetite.`
      : `${regime} regime, ${appetite} appetite: ${nAlloc} deploy${
          nAlloc === 1 ? "" : "s"
        }${nRetreat ? `, ${nRetreat} retreat${nRetreat === 1 ? "" : "s"}` : ""}.`;

  return {
    regime,
    appetite,
    moves,
    idleBefore: vault.idle,
    idleAfter,
    totalDeployedAfter,
    risks,
    summary,
    source: "risk-engine",
  };
}
