import { test } from "node:test";
import assert from "node:assert/strict";
import { csvToDecisions, parseCsv } from "../src/agentApi.js";
import { mapCsvDecision, mapDecision, mapReplay, mapStatus, mapVenues, matchesFilter, sameInstant, units } from "../src/mapping.js";
import { fixtureText, latestReceipts, movedRecord, statusFixture } from "./helpers.js";

const MOVED_HASH = "0x767b5e3505822551fde1dd562e47b0344786115cb06a979083ca4e7ea5446afd";

test("units: base-unit strings to decimal strings, null on junk", () => {
  assert.equal(units("46127"), "0.046127");
  assert.equal(units("1001481"), "1.001481");
  assert.equal(units("0"), "0");
  assert.equal(units(undefined), null);
  assert.equal(units("not-a-number"), null);
});

test("status: totals, regime, freshness, and pool state from the real / response", () => {
  const s = statusFixture();
  const last = Date.parse(s.latest!.takenAt!);
  const pool = { paused: false, totalAssets: 46_127n, totalSupply: 432n, shareDecimals: 6 };
  const out = mapStatus(s, true, new Date(last + 5 * 60_000), pool);

  assert.equal(out.agentOnline, true);
  assert.equal(out.decisionLoopActive, true);
  assert.equal(out.minutesSinceLastDecision, 5);
  assert.equal(out.lastDecisionAt, "2026-10-03T01:35:52.329Z");
  assert.deepEqual(out.decisions, { total: 5109, rebalanced: 185, held: 4924 });
  assert.equal(out.decisions.rebalanced! + out.decisions.held!, out.decisions.total);
  assert.equal(out.latestDecision?.regime, s.latest!.regime);
  assert.equal(out.latestDecision?.action, "held");
  assert.equal(out.agent.chainId, 196);
  assert.equal(out.agent.pool, "0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F");
  assert.deepEqual(out.pool, { totalAssetsUsdt0: "0.046127", totalShares: "0.000432", depositsPaused: false, withdrawalsPaused: false });
  assert.doesNotThrow(() => JSON.stringify(out));
});

test("status: a stale loop and an unreachable pool are reported, not thrown", () => {
  const s = statusFixture();
  const last = Date.parse(s.latest!.takenAt!);
  const out = mapStatus(s, false, new Date(last + 3 * 3_600_000), { error: "rpc down" });
  assert.equal(out.agentOnline, false);
  assert.equal(out.decisionLoopActive, false);
  assert.equal(out.minutesSinceLastDecision, 180);
  assert.deepEqual(out.pool, { error: "rpc down" });
});

test("venues: every snapshot venue joined to its risk score, sorted by risk-adjusted APY", () => {
  const rec = latestReceipts()[0]!;
  const out = mapVenues(rec);
  const snapVenues = rec.snapshot!.venues!;
  assert.equal(out.venues.length, snapVenues.length);
  assert.equal(out.snapshotAt, rec.snapshot!.takenAt);

  for (const v of out.venues) {
    const risk = rec.plan!.risks!.find((r) => r.name === v.name)!;
    const snap = snapVenues.find((s) => s.name === v.name)!;
    assert.ok(risk, `risk for ${v.name}`);
    assert.equal(v.apyPct, risk.apyBps! / 100);
    assert.equal(v.riskAdjustedApyPct, risk.riskAdjustedApyBps! / 100);
    assert.equal(v.riskBand, risk.band);
    assert.ok(v.riskScore! >= 0 && v.riskScore! <= 100);
    assert.equal(v.allowlisted, snap.allowed);
    assert.equal(v.currentValueUsdt0, units(snap.liveBalance));
  }
  const ra = out.venues.map((v) => v.riskAdjustedApyPct ?? -1);
  assert.deepEqual(ra, [...ra].sort((a, b) => b - a));

  // Allocation is each venue's live value over pool totalAssets; with idle at 0 the venues sum to 100%.
  const total = Number(rec.snapshot!.vault!.totalAssets);
  for (const v of out.venues) {
    const live = Number(snapVenues.find((s) => s.name === v.name)!.liveBalance);
    assert.equal(v.allocationPct, Math.round((live / total) * 10_000) / 100);
  }
  const allocated = out.venues.reduce((a, v) => a + (v.allocationPct ?? 0), 0) + (out.pool.idlePct ?? 0);
  assert.ok(Math.abs(allocated - 100) < 0.05, `allocations sum to ~100%, got ${allocated}`);
});

test("decisions: a hold and a move map to compact entries with tx links", () => {
  const hold = mapDecision(latestReceipts()[0]!);
  assert.equal(hold.action, "held");
  assert.deepEqual(hold.moves, []);
  assert.deepEqual(hold.transactions, []);
  assert.ok(hold.summary && hold.summary.length > 0);

  const moved = mapDecision(movedRecord());
  assert.equal(moved.takenAt, "2026-09-25T19:23:00.453Z");
  assert.equal(moved.action, "moved");
  assert.deepEqual(moved.moves, [
    { action: "allocate", venue: "Pendle PT-USDG (fixed, Oct 2026)", amountUsdt0: "1.001481", riskAdjustedApyPct: 2.96, band: "low" },
  ]);
  assert.deepEqual(moved.transactions, [
    { hash: MOVED_HASH, status: "confirmed", url: `https://www.oklink.com/xlayer/tx/${MOVED_HASH}` },
  ]);
});

test("decisions: filter matches the agent's own rebalanced definition (moves.length > 0)", () => {
  const hold = latestReceipts()[0]!;
  const moved = movedRecord();
  assert.equal(matchesFilter(hold, "held"), true);
  assert.equal(matchesFilter(hold, "moved"), false);
  assert.equal(matchesFilter(moved, "moved"), true);
  assert.equal(matchesFilter(moved, "all"), true);
});

test("replay: the full reasoning chain of a real move", () => {
  const r = mapReplay(movedRecord());
  assert.equal(r.regime, "calm");
  assert.equal(r.appetite, "moderate");
  assert.equal(r.riskScores.length, 5);
  for (const k of r.riskScores) {
    assert.ok(k.venue);
    assert.equal(typeof k.components.protocol, "number");
  }
  assert.equal(r.stressTest?.scenarios.length, 3);
  assert.equal(r.panel?.verdicts.length, 3);
  assert.deepEqual(r.panel?.verdicts.map((v) => v.role), ["peg", "liquidity", "macro"]);
  assert.equal(r.critic?.approved, true);
  assert.equal(r.reflection?.calibration, 1);
  assert.equal(r.plan.moves.length, 1);
  assert.match(r.plan.moves[0]!.rationale!, /Pendle PT-USDG/);
  assert.equal(r.plan.idleBeforeUsdt0, "1.637516");
  assert.equal(r.plan.idleAfterUsdt0, "0.636035");
  assert.equal(r.outcome.action, "moved");
  assert.equal(r.outcome.executed, true);
  assert.deepEqual(r.outcome.executions[0], {
    venue: "Pendle PT-USDG (fixed, Oct 2026)",
    action: "allocate",
    amountUsdt0: "1.001481",
    status: "confirmed",
    hash: MOVED_HASH,
    url: `https://www.oklink.com/xlayer/tx/${MOVED_HASH}`,
  });
  assert.doesNotThrow(() => JSON.stringify(r));
});

test("replay: a hold has no executions and still carries its safeguards", () => {
  const r = mapReplay(latestReceipts()[0]!);
  assert.equal(r.outcome.action, "held");
  assert.equal(r.outcome.executed, false);
  assert.deepEqual(r.outcome.executions, []);
  assert.ok(r.panel);
  assert.ok(r.critic);
});

test("replay: tolerates an old receipt with no safeguards block", () => {
  const r = mapReplay({ takenAt: "2026-08-10T23:12:51.361Z", plan: { regime: "calm", moves: [] } });
  assert.equal(r.stressTest, null);
  assert.equal(r.panel, null);
  assert.equal(r.critic, null);
  assert.deepEqual(r.riskScores, []);
});

test("csv: RFC 4180 quoting (commas, doubled quotes, newlines)", () => {
  const rows = parseCsv('a,b,c\n1,"x, y","he said ""hi"""\n2,"multi\nline",z\n');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "x, y", 'he said "hi"'],
    ["2", "multi\nline", "z"],
  ]);
});

test("csv: the real /receipts.csv excerpt parses into decisions", () => {
  const rows = csvToDecisions(fixtureText("decisions-excerpt.csv"));
  assert.equal(rows.length, 8);
  const moved = rows.find((r) => sameInstant(r.takenAt, "2026-09-25T19:23:00.453Z"))!;
  assert.equal(moved.action, "rebalanced");
  assert.equal(moved.moveCount, 1);
  assert.equal(moved.movedInto, "Pendle PT-USDG (fixed, Oct 2026)");
  assert.equal(moved.txHashes, MOVED_HASH);
  // The first rationale contains commas and must survive as one field.
  assert.match(rows[0]!.rationale, /utilization \(30%\), tight peg/);
  const m = mapCsvDecision(moved);
  assert.equal(m.action, "moved");
  assert.equal(m.moves[0]!.venue, "Pendle PT-USDG (fixed, Oct 2026)");
  assert.equal(m.transactions[0]!.hash, MOVED_HASH);
});

test("sameInstant: compares instants, not strings", () => {
  assert.equal(sameInstant("2026-10-03T01:20:48.775Z", "2026-10-03T01:20:48.775+00:00"), true);
  assert.equal(sameInstant("2026-10-03T01:20:48.775Z", "2026-10-03T01:20:48.776Z"), false);
  assert.equal(sameInstant(undefined, "2026-10-03T01:20:48.775Z"), false);
});
