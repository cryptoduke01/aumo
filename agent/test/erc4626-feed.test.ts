import { test } from "node:test";
import assert from "node:assert/strict";
import { erc4626ApyBps } from "../src/sense/erc4626Feed.ts";

const WAD = 10n ** 18n;
const YEAR = 365 * 24 * 60 * 60;

test("4% share-price growth over a year reads ~400 bps", () => {
  assert.equal(erc4626ApyBps(WAD, (WAD * 104n) / 100n, YEAR), 400);
});

test("annualizes a partial window: 2% over half a year is ~400 bps", () => {
  assert.equal(erc4626ApyBps(WAD, (WAD * 102n) / 100n, YEAR / 2), 400);
});

test("no growth (or a dip) over the window reads 0, not stale", () => {
  assert.equal(erc4626ApyBps(WAD, WAD, YEAR), 0);
  assert.equal(erc4626ApyBps(WAD, WAD - 1n, YEAR), 0);
});

test("an implausible reading is clamped to the 20% ceiling", () => {
  assert.equal(erc4626ApyBps(WAD, WAD * 2n, YEAR), 2000); // 100% -> clamped
});

test("guards: zero prior price or non-positive period read 0", () => {
  assert.equal(erc4626ApyBps(0n, WAD, YEAR), 0);
  assert.equal(erc4626ApyBps(WAD, (WAD * 104n) / 100n, 0), 0);
});
