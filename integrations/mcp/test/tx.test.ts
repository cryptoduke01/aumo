import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, parseAbi, toFunctionSelector, type Address } from "viem";
import { CHAIN_ID, POOL, USDT0 } from "../src/config.js";
import { buildApproveTx, buildDepositTx, buildRedeemTx, buildWithdrawTx, parseAssetAmount } from "../src/tx.js";

// Decode with an ABI written independently of src/tx.ts, straight from the ERC-20 / ERC-4626
// signatures, so a typo in the server's ABI would fail here instead of round-tripping silently.
const reference = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

const ALICE = "0x1111111111111111111111111111111111111111" as Address;
const BOB = "0x2222222222222222222222222222222222222222" as Address;

test("approve: targets USDT0, spender is the pool, exact amount, standard selector", () => {
  const tx = buildApproveTx(ALICE, 25_500_000n);
  assert.equal(tx.to, USDT0);
  assert.equal(tx.from, ALICE);
  assert.equal(tx.chainId, CHAIN_ID);
  assert.equal(tx.value, "0");
  assert.equal(tx.data.slice(0, 10), "0x095ea7b3");
  const d = decodeFunctionData({ abi: reference, data: tx.data });
  assert.equal(d.functionName, "approve");
  assert.deepEqual(d.args, [POOL, 25_500_000n]);
});

test("deposit: targets the pool with (assets, receiver)", () => {
  const tx = buildDepositTx(ALICE, 1_000_000n, BOB, 2);
  assert.equal(tx.to, POOL);
  assert.equal(tx.step, 2);
  assert.equal(tx.value, "0");
  assert.equal(tx.data.slice(0, 10), toFunctionSelector("deposit(uint256,address)"));
  assert.equal(tx.data.slice(0, 10), "0x6e553f65");
  const d = decodeFunctionData({ abi: reference, data: tx.data });
  assert.equal(d.functionName, "deposit");
  assert.deepEqual(d.args, [1_000_000n, BOB]);
});

test("withdraw: targets the pool with (assets, receiver, owner)", () => {
  const tx = buildWithdrawTx(ALICE, 7n, BOB);
  assert.equal(tx.to, POOL);
  assert.equal(tx.from, ALICE);
  assert.equal(tx.data.slice(0, 10), "0xb460af94");
  const d = decodeFunctionData({ abi: reference, data: tx.data });
  assert.equal(d.functionName, "withdraw");
  assert.deepEqual(d.args, [7n, BOB, ALICE]);
});

test("redeem: targets the pool with (shares, receiver, owner)", () => {
  const tx = buildRedeemTx(ALICE, 432n, ALICE, "0.000432");
  assert.equal(tx.to, POOL);
  assert.equal(tx.data.slice(0, 10), "0xba087652");
  const d = decodeFunctionData({ abi: reference, data: tx.data });
  assert.equal(d.functionName, "redeem");
  assert.deepEqual(d.args, [432n, ALICE, ALICE]);
});

test("unsigned txs never carry a signature, gas, or nonce", () => {
  const tx = buildDepositTx(ALICE, 1n, ALICE);
  assert.deepEqual(Object.keys(tx).sort(), ["chainId", "data", "from", "kind", "step", "summary", "to", "value"]);
});

test("parseAssetAmount: 6-decimal USDT0 base units", () => {
  assert.equal(parseAssetAmount("25"), 25_000_000n);
  assert.equal(parseAssetAmount("25.5"), 25_500_000n);
  assert.equal(parseAssetAmount(" 0.000001 "), 1n);
  assert.equal(parseAssetAmount("1000000.123456"), 1_000_000_123_456n);
});

test("parseAssetAmount: rejects zero, negatives, exponents, extra decimals, junk", () => {
  for (const bad of ["0", "0.0", "-1", "1e3", "1.0000001", "abc", "", ".5", "1,000", "0x10", "Infinity"]) {
    assert.throws(() => parseAssetAmount(bad), Error, `should reject "${bad}"`);
  }
});
