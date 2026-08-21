import { test } from "node:test";
import assert from "node:assert/strict";
import { lpApyBps } from "../src/sense/univ3LpFeed.js";

const Q129 = 1n << 129n;
const YEAR = 365 * 24 * 60 * 60;
const near = (a: number, b: number, tol = 2) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("lp fee APY: a 1% fee-growth yield over a full year is ~100 bps", () => {
  near(lpApyBps(Q129 / 100n, YEAR), 100);
});

test("lp fee APY: a 5% yield over a year is ~500 bps", () => {
  near(lpApyBps(Q129 / 20n, YEAR), 500);
});

test("lp fee APY: annualizes a short window (0.001% over an hour -> ~876 bps)", () => {
  near(lpApyBps(Q129 / 100000n, 3600), 876);
});

test("lp fee APY: no fees accrued (zero or negative delta) is 0", () => {
  assert.equal(lpApyBps(0n, YEAR), 0);
  assert.equal(lpApyBps(-42n, YEAR), 0);
  assert.equal(lpApyBps(Q129, 0), 0); // zero period
});

test("lp fee APY: an absurd reading is clamped, never trusted as real", () => {
  assert.equal(lpApyBps(Q129, YEAR), 5000); // raw 10000 bps -> clamped
  assert.equal(lpApyBps(Q129 * 100n, YEAR), 5000);
});
