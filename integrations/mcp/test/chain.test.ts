import { test } from "node:test";
import assert from "node:assert/strict";
import { CallExecutionError, ExecutionRevertedError, HttpRequestError } from "viem";
import { classifyCallError } from "../src/chain.js";

// The dry run must never read a flaky RPC as "this transaction would revert", and vice versa.

test("a contract revert is classified as reverts", () => {
  const revert = new ExecutionRevertedError({ message: "execution reverted: ERC4626ExceededMaxWithdraw" });
  const wrapped = new CallExecutionError(revert, {});
  assert.equal(classifyCallError(wrapped).status, "reverts");
  assert.equal(classifyCallError(revert).status, "reverts");
});

test("a network failure is inconclusive, not a revert", () => {
  const net = new HttpRequestError({ url: "https://rpc.xlayer.tech", status: 503, body: { method: "eth_call" } });
  const r = classifyCallError(net);
  assert.equal(r.status, "unknown");
  assert.equal(classifyCallError(new Error("socket hang up")).status, "unknown");
});
