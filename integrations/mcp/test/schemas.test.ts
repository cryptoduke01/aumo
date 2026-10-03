import { test } from "node:test";
import assert from "node:assert/strict";
import { addressSchema, amountSchema, schemas, withdrawAmountSchema } from "../src/schemas.js";

const CHECKSUMMED = "0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F";

test("address: lowercase is accepted and checksummed", () => {
  assert.equal(addressSchema.parse(CHECKSUMMED.toLowerCase()), CHECKSUMMED);
  assert.equal(addressSchema.parse(`  ${CHECKSUMMED}  `), CHECKSUMMED);
});

test("address: a broken checksum, short, or non-hex value is rejected", () => {
  const badChecksum = CHECKSUMMED.replace("8a98A4A8", "8a98a4A8");
  for (const bad of [badChecksum, "0x1234", "0xZZ98A4A868e5FBAc05B9d1dC0742BD008354114F", "vitalik.eth", ""]) {
    assert.equal(addressSchema.safeParse(bad).success, false, `should reject ${bad}`);
  }
});

test("amount: decimal strings and plain numbers become USDT0 base units", () => {
  assert.equal(amountSchema.parse("10"), 10_000_000n);
  assert.equal(amountSchema.parse("0.5"), 500_000n);
  assert.equal(amountSchema.parse(2.5), 2_500_000n);
});

test("amount: zero, negative, too precise, and exponent forms are rejected with a message", () => {
  for (const bad of ["0", "-5", "1.1234567", "1e6", 1e-7, "ten", ""]) {
    const r = amountSchema.safeParse(bad);
    assert.equal(r.success, false, `should reject ${String(bad)}`);
  }
  const r = amountSchema.safeParse("1.1234567");
  assert.match(r.error!.issues[0]!.message, /at most 6 decimals/);
});

test("withdraw amount: 'max' (any case) or a positive amount", () => {
  assert.equal(withdrawAmountSchema.parse("max"), "max");
  assert.equal(withdrawAmountSchema.parse("ALL"), "max");
  assert.equal(withdrawAmountSchema.parse("3.25"), 3_250_000n);
  assert.equal(withdrawAmountSchema.safeParse("half").success, false);
});

test("decisions: defaults and bounds", () => {
  assert.deepEqual(schemas.decisions.parse({}), { limit: 10, filter: "all" });
  assert.deepEqual(schemas.decisions.parse({ limit: 3, filter: "moved" }), { limit: 3, filter: "moved" });
  for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: 2.5 }, { filter: "sold" }]) {
    assert.equal(schemas.decisions.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("replay: takenAt is optional but must be a timestamp when given", () => {
  assert.deepEqual(schemas.replay.parse({}), {});
  assert.equal(schemas.replay.parse({ takenAt: "2026-09-25T19:23:00.453Z" }).takenAt, "2026-09-25T19:23:00.453Z");
  assert.equal(schemas.replay.safeParse({ takenAt: "yesterday-ish" }).success, false);
});

test("ask: question is required, trimmed, and capped at 500 chars", () => {
  assert.equal(schemas.ask.parse({ question: "  where does the yield come from?  " }).question, "where does the yield come from?");
  assert.equal(schemas.ask.safeParse({ question: "   " }).success, false);
  assert.equal(schemas.ask.safeParse({ question: "x".repeat(501) }).success, false);
  assert.equal(schemas.ask.safeParse({ question: "mine?", address: "0xnope" }).success, false);
});

test("prepare deposit / withdraw: required fields", () => {
  const from = CHECKSUMMED.toLowerCase();
  const d = schemas.prepareDeposit.parse({ from, amount: "1" });
  assert.equal(d.from, CHECKSUMMED);
  assert.equal(d.amount, 1_000_000n);
  assert.equal(d.receiver, undefined);
  assert.equal(schemas.prepareDeposit.safeParse({ amount: "1" }).success, false);
  assert.equal(schemas.prepareDeposit.safeParse({ from }).success, false);
  assert.equal(schemas.prepareWithdraw.parse({ owner: from, amount: "max" }).amount, "max");
  assert.equal(schemas.prepareWithdraw.safeParse({ owner: from, amount: "0" }).success, false);
});
