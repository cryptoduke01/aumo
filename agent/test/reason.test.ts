import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTighten, extractJson, LlmReply } from "../src/brain/reason.js";

test("the model cannot loosen the appetite", () => {
  const { appetite } = resolveTighten(
    { regime: "calm", appetite: "moderate" },
    { regime: "calm", appetite: "elevated", veto: [] },
  );
  assert.equal(appetite, "moderate"); // elevated > moderate is rejected
});

test("the model cannot loosen the regime", () => {
  const { regime } = resolveTighten(
    { regime: "cautious", appetite: "moderate" },
    { regime: "calm", appetite: "moderate", veto: [] },
  );
  assert.equal(regime, "cautious"); // calm is looser than cautious, rejected
});

test("the model can tighten both regime and appetite", () => {
  const { regime, appetite } = resolveTighten(
    { regime: "calm", appetite: "moderate" },
    { regime: "defensive", appetite: "low", veto: [] },
  );
  assert.equal(regime, "defensive");
  assert.equal(appetite, "low");
});

test("vetoes are normalized to lowercase", () => {
  const { deny } = resolveTighten(
    { regime: "calm", appetite: "moderate" },
    { regime: "calm", appetite: "moderate", veto: ["0xABCDEF0000000000000000000000000000000001"] },
  );
  assert.ok(deny.has("0xabcdef0000000000000000000000000000000001"));
});

test("extractJson pulls the object out of fenced, prose-wrapped replies", () => {
  const reply = 'Here is my decision:\n```json\n{ "regime": "calm", "appetite": "low", "veto": [], "narrative": "ok" }\n```\nDone.';
  const parsed = LlmReply.parse(JSON.parse(extractJson(reply)));
  assert.equal(parsed.appetite, "low");
});

test("extractJson throws when there is no object", () => {
  assert.throws(() => extractJson("no json here"));
});

test("LlmReply rejects an out-of-vocabulary regime", () => {
  assert.throws(() =>
    LlmReply.parse({ regime: "yolo", appetite: "low", veto: [], narrative: "x" }),
  );
});
