import { test } from "node:test";
import assert from "node:assert/strict";
import { reflect } from "../src/brain/reflect.js";
import type { VenueHistory } from "../src/types.js";

const sample = (u: number, liq: number) => ({
  utilization: u,
  pegDeviationBps: 0,
  liquidityUsd: liq,
  tvlUsd: 1_000_000,
  apyBps: 800,
});

test("reflection: predictive momentum raises calibration above 1x, tighten-only", () => {
  // A steadily deteriorating series: utilization climbs and liquidity thins every cycle, so whenever
  // momentum flags, the next cycle is indeed worse — momentum is predictive here.
  const addr = "0x00000000000000000000000000000000000000a1";
  const samples = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((u, i) => sample(u, 500_000 - i * 60_000));
  const hist: VenueHistory = { [addr]: samples };
  const r = reflect(hist);
  assert.ok(r.flagged > 0, "momentum fired somewhere in the series");
  assert.ok(r.hitRate > 0.6, "deterioration reliably continued");
  assert.ok(r.calibration > 1 && r.calibration <= 1.5, "calibration scales up, bounded");
  assert.ok(r.lessons.length > 0);
});

test("reflection is neutral with no history", () => {
  const r = reflect(undefined);
  assert.equal(r.calibration, 1);
  assert.equal(r.flagged, 0);
});
