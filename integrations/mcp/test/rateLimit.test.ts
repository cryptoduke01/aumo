import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/rateLimit.js";

test("rate limiter: a client gets its per-minute budget, then waits for the next window", () => {
  const rl = createRateLimiter(3);
  const t = 1_000_000;
  assert.deepEqual([rl.take("a", t), rl.take("a", t + 1), rl.take("a", t + 2), rl.take("a", t + 3)], [true, true, true, false]);
  assert.equal(rl.take("b", t + 3), true); // budgets are per client
  assert.equal(rl.take("a", t + 59_999), false);
  assert.equal(rl.take("a", t + 60_000), true); // new window
});

test("rate limiter: a full client table evicts expired windows and never grows past its cap", () => {
  const rl = createRateLimiter(5, 2);
  assert.equal(rl.take("a", 0), true);
  assert.equal(rl.take("b", 0), true);
  assert.equal(rl.take("c", 10), false); // table full of live clients
  assert.equal(rl.take("c", 60_000), true); // a and b expired and were dropped
});
