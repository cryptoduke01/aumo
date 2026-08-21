import type { Address, MarketSnapshot, Regime, RiskBand } from "../types.js";
import { BAND_RANK, scorePortfolio, type VenueRisk } from "../risk/engine.js";
import type { StressReport } from "../risk/stress.js";
import type { Reflection } from "./reflect.js";
import type { CriticVerdict } from "./critic.js";
import {
  IDLE_FLOOR,
  MOMENTUM_VETO,
  LIQUIDITY_SHARE_CAP,
  REBALANCE_MIN_EDGE_BPS,
  ROTATION_ROUNDTRIP_BPS,
  HARD_PEG_BREAK_BPS,
} from "./critic.js";

const SECONDS_PER_YEAR = 31_536_000;
// Floor on any proposed move, in whole asset units ($1 at 6 decimals). Venues that route through a
// swap (Pendle's USDT0→USDG→PT, USDG's redemption) revert on sub-cent "dust" — the swap rounds the
// output to zero or trips a minimum. The buffer arithmetic can leave a sliver of deployable idle, so
// without this floor the planner would propose a dust allocate that reverts on-chain every cycle.
const MIN_MOVE_USD = 1;
import type { PanelResult } from "./panel.js";

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
  rebalance?: boolean; // set on both legs of a venue-to-venue rotation; the critic keeps them atomic
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
  source: "risk-engine" | "risk-engine+llm" | "risk-engine+panel";
  stress?: StressReport; // scenario-simulation result attached in the tick, carried into the receipt
  reflection?: Reflection; // self-calibration from replaying past trend calls, carried into the receipt
  critic?: CriticVerdict; // adversarial final-gate verdict (vetoes / doubt-hold)
  panel?: PanelResult; // specialist-agent panel that produced the reasoning (collective layer)
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
  const minMove = BigInt(Math.round(MIN_MOVE_USD * unit)); // skip dust moves that revert on swap venues
  const portfolioUnits = (Number(vault.idle) + Number(vault.totalDeployed)) / unit;

  const risks = scorePortfolio(
    snap.venues,
    vault.decimals,
    portfolioUnits,
    snap.history,
    snap.momentumCalibration ?? 1,
  );
  const riskByAddr = new Map(risks.map((r) => [r.address.toLowerCase(), r]));

  const moves: Move[] = [];

  // 1) Retreat first. Any venue we hold that is no longer allowlisted or whose risk band now exceeds
  //    appetite is fully unwound. On top of that, a DEPEG CIRCUIT BREAKER forces an immediate full
  //    exit the instant an RWA venue's peg breaks past HARD_PEG_BREAK_BPS, independent of the
  //    graduated band, so a fast depeg is met with an instant exit rather than a slow re-score.
  //    Retreat is never blocked, so both always execute.
  for (const v of snap.venues) {
    const r = riskByAddr.get(v.address.toLowerCase());
    if (!r) continue;
    const outOfPolicy = !v.allowed || BAND_RANK[r.band] > BAND_RANK[appetite];
    const pegDevBreak = v.pegDeviationBps > HARD_PEG_BREAK_BPS;
    // Persistent peg blindness: an RWA venue whose peg feed failed to verify THIS cycle AND in the most
    // recent prior cycle. A single transient miss is tolerated (no churn); sustained blindness on a
    // live RWA position means the depeg breaker itself is running blind — we can no longer confirm the
    // peg — so we exit rather than hold an unverifiable RWA. Closes the "feed-down disarms the breaker"
    // gap without exiting on one flaky read.
    const priorSamples = snap.history?.[v.address.toLowerCase()];
    const priorSample = priorSamples && priorSamples.length ? priorSamples[priorSamples.length - 1] : undefined;
    const pegBlind =
      v.kind === "rwa" && v.pegVerified !== true && priorSample !== undefined && priorSample.pegVerified !== true;
    const pegBreak = pegDevBreak || pegBlind;
    if (v.allocatedPrincipal > 0n && (outOfPolicy || pegBreak)) {
      const amount = v.liveBalance > 0n ? v.liveBalance : v.allocatedPrincipal;
      const breakerRationale = pegDevBreak
        ? `Depeg circuit breaker: ${v.name} peg deviation is ${v.pegDeviationBps} bps, past the ${HARD_PEG_BREAK_BPS} bps breaker. Full exit now, before it becomes a loss.`
        : `Depeg circuit breaker: ${v.name} peg could not be verified on-chain for two cycles running. Exiting a live RWA position we can no longer confirm.`;
      moves.push({
        venue: v.address,
        venueName: v.name,
        action: "deallocate",
        amount,
        reasonTag: pegDevBreak
          ? `depeg:${v.pegDeviationBps}bps`.slice(0, 31)
          : pegBlind
            ? "depeg:unverified"
            : `retreat:${r.band}`.slice(0, 31),
        rationale: pegBreak
          ? breakerRationale
          : `Exit ${v.name}: ${
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
  // Reserve the same idle buffer the critic enforces (IDLE_FLOOR of the whole pool), so the plan
  // never proposes deploying so much that the critic must veto the entire cycle. Without this, a
  // calm regime deploys 100% of idle, the critic then rejects it for a 0% buffer, and the agent
  // never allocates at any size. Rounded up so idleAfter clears the floor with room to spare.
  const idlePlusDeployed = vault.idle + vault.totalDeployed;
  const bufferReserve = (idlePlusDeployed * BigInt(Math.round(IDLE_FLOOR * 10000)) + 9999n) / 10000n;
  const deployableIdle = vault.idle > bufferReserve ? vault.idle - bufferReserve : 0n;
  if (budget > deployableIdle) budget = deployableIdle;

  const portfolioBig = vault.idle + vault.totalDeployed;
  const concCap = (portfolioBig * BigInt(Math.round(maxConc * 10000))) / 10000n;

  const eligible = snap.venues
    .filter((v) => v.allowed && !deny.has(v.address.toLowerCase()) && v.pegDeviationBps <= HARD_PEG_BREAK_BPS)
    .map((v) => ({ v, r: riskByAddr.get(v.address.toLowerCase())! }))
    // Exclude venues the critic would veto anyway (deteriorating momentum), so budget flows to the
    // next-best venue instead of being spent on a move that gets removed and stranded.
    .filter(({ r }) => r && BAND_RANK[r.band] <= BAND_RANK[appetite] && r.momentumRisk <= MOMENTUM_VETO)
    .sort((a, b) => b.r.riskAdjustedApyBps - a.r.riskAdjustedApyBps);

  for (const { v, r } of eligible) {
    if (budget <= 0n) break;
    // Size headroom on exposure = max(principal, live), mirroring the contract's cap check
    // (_venueExposure), so a yield-bearing venue that has accrued above principal is never over-sized
    // into a PerVenueCap/MaxTotalDeployed revert.
    const already = v.liveBalance > v.allocatedPrincipal ? v.liveBalance : v.allocatedPrincipal;
    const perVenueHeadroom = vault.perVenueCap > already ? vault.perVenueCap - already : 0n;
    const concHeadroom = concCap > already ? concCap - already : 0n;
    // Cap the position at the critic's exit-liquidity share (LIQUIDITY_SHARE_CAP of the venue's
    // withdrawable depth), so the planner proposes the largest size the critic will ACCEPT instead
    // of an over-sized one it vetoes wholesale — which would leave a thin-liquidity venue (e.g.
    // Pendle) unfunded at any real pool size. Uncapped when liquidity is unknown, matching the critic.
    const liqCapUnits = v.liquidityUsd > 0 ? BigInt(Math.floor(LIQUIDITY_SHARE_CAP * v.liquidityUsd * unit)) : 0n;
    const liqHeadroom = liqCapUnits > already ? liqCapUnits - already : 0n;

    let size = budget;
    if (size > vault.maxMoveSize) size = vault.maxMoveSize;
    if (size > perVenueHeadroom) size = perVenueHeadroom;
    if (size > concHeadroom) size = concHeadroom;
    if (v.liquidityUsd > 0 && size > liqHeadroom) size = liqHeadroom;
    if (size < minMove) continue; // don't propose a dust deploy that reverts on the venue's swap floor

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

  // 3) Rebalance: rotate capital from the lowest risk-adjusted venue we hold into the best eligible
  //    venue when the risk-adjusted edge clears REBALANCE_MIN_EDGE_BPS. Retreat and idle-deploy ran
  //    first, so this only fires when idle alone couldn't reach the better venue. Bounded to one
  //    move-sized step per cycle and to the target's caps and exit-liquidity share, so it rotates
  //    gradually and the on-chain per-epoch loss budget hard-caps the realized round-trip cost.
  let rotationNote: string | null = null; // sophisticated-hold reasoning, surfaced in the receipt
  const nowSec = Math.floor(Date.parse(snap.takenAt) / 1000);
  const nowValid = Number.isFinite(nowSec);
  const target = eligible[0]; // highest risk-adjusted, already band/momentum/deny-filtered
  if (target) {
    const targetKey = target.v.address.toLowerCase();
    const retreating = new Set(
      moves.filter((m) => m.action === "deallocate").map((m) => m.venue.toLowerCase()),
    );
    // Venues step 2 just topped up this cycle: never rotate OUT of one we just deployed INTO, or the
    // plan would deposit and withdraw the same venue in one cycle — a wasted round-trip, and on an RWA
    // venue a real swap loss that also needlessly burns the on-chain loss budget.
    const deployedInto = new Set(
      moves.filter((m) => m.action === "allocate").map((m) => m.venue.toLowerCase()),
    );
    // Held venues we could rotate OUT of: funded, not the target, not being retreated, and not just
    // deployed into. A held venue that is not retreated is by construction allowlisted and within
    // appetite (step 1 unwinds anything that is not), so this only ever rotates between healthy venues.
    const candidates = snap.venues
      .map((v) => ({ v, r: riskByAddr.get(v.address.toLowerCase()) }))
      .filter(
        (x) =>
          x.r &&
          x.v.liveBalance > 0n &&
          x.v.address.toLowerCase() !== targetKey &&
          !retreating.has(x.v.address.toLowerCase()) &&
          !deployedInto.has(x.v.address.toLowerCase()),
      )
      .sort((a, b) => a.r!.riskAdjustedApyBps - b.r!.riskAdjustedApyBps);
    const source = candidates[0];

    if (source && source.r) {
      const edge = target.r.riskAdjustedApyBps - source.r.riskAdjustedApyBps;
      // Horizon gate for a FIXED-MATURITY target: the edge is annualized, but it can only be earned
      // over the time left to maturity. If that pickup (edge × years-left) can't clear the round-trip
      // cost, rotating in loses money before the position matures — decline and record why. A
      // perpetual target (no maturityTs) has an unbounded horizon and skips this gate entirely.
      let horizonOk = true;
      if (edge >= REBALANCE_MIN_EDGE_BPS && target.v.maturityTs) {
        const yearsLeft = nowValid ? Math.max(0, (target.v.maturityTs - nowSec) / SECONDS_PER_YEAR) : 0;
        const pickupBps = edge * yearsLeft;
        if (pickupBps < ROTATION_ROUNDTRIP_BPS) {
          horizonOk = false;
          rotationNote = `${target.v.name} shows a ${(edge / 100).toFixed(2)}% risk-adjusted edge over ${
            source.v.name
          }, but with ~${(yearsLeft * 12).toFixed(1)} months to maturity only ~${Math.round(
            pickupBps,
          )}bps is realizable before then — below the ~${ROTATION_ROUNDTRIP_BPS}bps round-trip cost. Holding rather than chasing yield that will not be captured in time.`;
        }
      }
      if (edge >= REBALANCE_MIN_EDGE_BPS && horizonOk) {
        // Target headroom AFTER any step-2 idle deploy into it this cycle.
        const targetAdded = moves
          .filter((m) => m.action === "allocate" && m.venue === target.v.address)
          .reduce((a, m) => a + m.amount, 0n);
        // Headroom on exposure = max(principal, live) + this cycle's top-up, mirroring the contract,
        // so an accrued target isn't over-sized into a revert that would strand the rotation-out leg.
        const targetExposure =
          target.v.liveBalance > target.v.allocatedPrincipal ? target.v.liveBalance : target.v.allocatedPrincipal;
        const held = targetExposure + targetAdded;
        const perVenueHeadroom = vault.perVenueCap > held ? vault.perVenueCap - held : 0n;
        const concHeadroom = concCap > held ? concCap - held : 0n;
        const liqCapUnits =
          target.v.liquidityUsd > 0
            ? BigInt(Math.floor(LIQUIDITY_SHARE_CAP * target.v.liquidityUsd * unit))
            : 0n;
        const liqHeadroom = liqCapUnits > held ? liqCapUnits - held : 0n;

        let rot = source.v.liveBalance;
        if (rot > vault.maxMoveSize) rot = vault.maxMoveSize;
        if (rot > perVenueHeadroom) rot = perVenueHeadroom;
        if (rot > concHeadroom) rot = concHeadroom;
        if (target.v.liquidityUsd > 0 && rot > liqHeadroom) rot = liqHeadroom;

        if (rot >= minMove) {
          const edgePct = (edge / 100).toFixed(2);
          moves.push({
            venue: source.v.address,
            venueName: source.v.name,
            action: "deallocate",
            amount: rot,
            reasonTag: `rotate:out:ra${source.r.riskAdjustedApyBps}`.slice(0, 31),
            rationale: `Rotate out of ${source.v.name} (${(source.r.riskAdjustedApyBps / 100).toFixed(
              2,
            )}% risk-adjusted) into ${target.v.name} (${(target.r.riskAdjustedApyBps / 100).toFixed(
              2,
            )}%) — a ${edgePct}% edge that clears the ${(REBALANCE_MIN_EDGE_BPS / 100).toFixed(
              0,
            )}% rotation floor. The per-epoch loss budget caps the realized round-trip cost.`,
            band: source.r.band,
            riskScore: source.r.riskScore,
            riskAdjustedApyBps: source.r.riskAdjustedApyBps,
            rebalance: true,
          });
          moves.push({
            venue: target.v.address,
            venueName: target.v.name,
            action: "allocate",
            amount: rot,
            reasonTag: `rotate:in:ra${target.r.riskAdjustedApyBps}`.slice(0, 31),
            rationale: `Rotate into ${target.v.name} at ${(target.v.apyBps / 100).toFixed(
              2,
            )}% APY (${(target.r.riskAdjustedApyBps / 100).toFixed(
              2,
            )}% risk-adjusted) from ${source.v.name}, capturing a ${edgePct}% risk-adjusted edge over the horizon.`,
            band: target.r.band,
            riskScore: target.r.riskScore,
            riskAdjustedApyBps: target.r.riskAdjustedApyBps,
            rebalance: true,
          });
        }
      }
    }
  }

  // Projected balances (principal basis; ignores accrued yield on retreat). A rotation's deallocate
  // is credited at its FULL amount, not principal-capped: it is idle-neutral by construction (exactly
  // what it withdraws funds the paired deposit), so it must not appear to draw down the buffer.
  const allocSum = moves
    .filter((m) => m.action === "allocate")
    .reduce((a, m) => a + m.amount, 0n);
  const deallocCredit = moves
    .filter((m) => m.action === "deallocate")
    .reduce((a, m) => {
      if (m.rebalance) return a + m.amount;
      const v = snap.venues.find((x) => x.address === m.venue);
      const principal = v?.allocatedPrincipal ?? 0n;
      return a + (m.amount > principal ? principal : m.amount);
    }, 0n);

  const idleAfter = vault.idle - allocSum + deallocCredit;
  const totalDeployedAfter = vault.totalDeployed + allocSum - deallocCredit;

  const nAlloc = moves.filter((m) => m.action === "allocate" && !m.rebalance).length;
  const nRetreat = moves.filter((m) => m.action === "deallocate" && !m.rebalance).length;
  const nRotate = moves.filter((m) => m.rebalance && m.action === "allocate").length; // one per pair
  const parts: string[] = [];
  if (nAlloc) parts.push(`${nAlloc} deploy${nAlloc === 1 ? "" : "s"}`);
  if (nRotate) parts.push(`${nRotate} rotation${nRotate === 1 ? "" : "s"}`);
  if (nRetreat) parts.push(`${nRetreat} retreat${nRetreat === 1 ? "" : "s"}`);
  const base =
    moves.length === 0
      ? `Hold. No move improves the risk-adjusted position within a ${regime} regime and ${appetite} appetite.`
      : `${regime} regime, ${appetite} appetite: ${parts.join(", ")}.`;
  // Surface a declined-rotation rationale so the receipt shows the horizon reasoning, not a bare hold.
  const summary = rotationNote ? `${base} ${rotationNote}` : base;

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
