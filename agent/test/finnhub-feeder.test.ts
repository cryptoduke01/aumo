import { test } from "node:test";
import assert from "node:assert/strict";
import { stringToHex, parseUnits } from "viem";
import {
  MARKET_STATUS,
  priceToWad,
  sessionToStatus,
  symbolToFeedId,
} from "../src/equity/finnhubClient.ts";

// The self-hosted oracle feeder converts a Finnhub quote into the exact on-chain shape the
// SelfHostedEquityOracle expects: feedId = bytes32(symbol), price = 1e18-scaled USD, and a 24/5
// market-status code folded from Finnhub's session/isOpen. These pure helpers are what the on-chain
// guards trust, so they are unit-pinned here.

test("symbolToFeedId matches the contract's bytes32(symbol) padding", () => {
  // The oracle registers feeds as bytes32("NVDA"); the feeder must produce the identical id.
  assert.equal(symbolToFeedId("NVDA"), stringToHex("NVDA", { size: 32 }));
  assert.equal(symbolToFeedId("TSLA"), stringToHex("TSLA", { size: 32 }));
  assert.notEqual(symbolToFeedId("NVDA"), symbolToFeedId("AAPL"));
});

test("priceToWad scales USD per share to 1e18", () => {
  assert.equal(priceToWad(227.5), parseUnits("227.5", 18));
  assert.equal(priceToWad(1), 10n ** 18n);
  // Under the oracle's absurd-price cap ($1,000,000/share).
  assert.ok(priceToWad(999_999) < parseUnits("1000000", 18));
});

test("priceToWad rejects a non-positive or non-finite price", () => {
  assert.throws(() => priceToWad(0));
  assert.throws(() => priceToWad(-5));
  assert.throws(() => priceToWad(Number.NaN));
});

test("sessionToStatus maps named sessions to the oracle codes", () => {
  assert.equal(sessionToStatus("pre-market", true), MARKET_STATUS.PRE);
  assert.equal(sessionToStatus("regular", true), MARKET_STATUS.REGULAR);
  assert.equal(sessionToStatus("post-market", false), MARKET_STATUS.POST);
  // Case-insensitive.
  assert.equal(sessionToStatus("Regular", true), MARKET_STATUS.REGULAR);
});

test("sessionToStatus fails CLOSED when it can't resolve a tradeable session", () => {
  // No session and not open -> CLOSED (fail safe, never trade blind).
  assert.equal(sessionToStatus(null, false), MARKET_STATUS.CLOSED);
  assert.equal(sessionToStatus(undefined, false), MARKET_STATUS.CLOSED);
  assert.equal(sessionToStatus("", false), MARKET_STATUS.CLOSED);
  // Unknown session but the source says open -> treat as regular.
  assert.equal(sessionToStatus(null, true), MARKET_STATUS.REGULAR);
});
