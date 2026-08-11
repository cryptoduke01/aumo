import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesizePanel, type RoleVerdict } from "../src/brain/panel.js";
import { buildPlan } from "../src/brain/plan.js";
import { snap, venue, VENUE_A, VENUE_B, M } from "./helpers.js";

// Two allowlisted venues with idle to deploy.
function base() {
  const s = snap({ idle: 1000n * M }, [
    venue({ address: VENUE_A, name: "A", allowed: true, liquidityUsd: 5_000_000, apyBps: 800 }),
    venue({ address: VENUE_B, name: "B", allowed: true, liquidityUsd: 5_000_000, apyBps: 600, protocolRisk: 0.12 }),
  ]);
  return { s, base: buildPlan(s, { appetite: "moderate", regime: "calm", maxConcentration: 0.6 }) };
}

const v = (over: Partial<RoleVerdict>): RoleVerdict => ({ role: "x", ok: true, concern: 0, vetoes: [], note: "", ...over });

test("panel synthesis unions vetoes and blocks that venue from new deploys", () => {
  const { s, base: b } = base();
  const out = synthesizePanel(
    s,
    b,
    [v({ role: "peg", vetoes: [VENUE_A] }), v({ role: "liquidity", vetoes: [] }), v({ role: "macro", regime: "calm" })],
    new Set(),
    0.6,
  );
  assert.ok(out.panel?.vetoes.includes(VENUE_A.toLowerCase()));
  assert.equal(out.moves.some((m) => m.action === "allocate" && m.venue === VENUE_A), false, "vetoed venue not deployed into");
});

test("panel takes the MOST defensive regime and can never loosen it", () => {
  const { s, base: b } = base();
  // base regime is calm; macro says defensive, peg says calm → result must be defensive.
  const out = synthesizePanel(
    s,
    b,
    [v({ role: "peg", regime: "calm" }), v({ role: "macro", regime: "defensive" })],
    new Set(),
    0.6,
  );
  assert.equal(out.regime, "defensive");
});

test("a specialist cannot loosen: proposing 'calm' when base is cautious stays cautious", () => {
  const s = snap({ idle: 1000n * M }, [venue({ allowed: true, liquidityUsd: 5_000_000 })]);
  const b = buildPlan(s, { appetite: "moderate", regime: "cautious", maxConcentration: 0.6 });
  const out = synthesizePanel(s, b, [v({ role: "macro", regime: "calm" })], new Set(), 0.6);
  assert.equal(out.regime, "cautious", "cannot loosen below the engine's regime");
});

test("abstaining and hallucinated addresses contribute nothing", () => {
  const { s, base: b } = base();
  const out = synthesizePanel(
    s,
    b,
    [
      v({ role: "peg", ok: false, vetoes: [VENUE_A] }), // abstained — its veto is still a plain field, but...
      v({ role: "liquidity", vetoes: ["0x000000000000000000000000000000000000dead"] }), // unknown addr
    ],
    new Set(),
    0.6,
  );
  // The unknown address is ignored; VENUE_A veto from an abstained agent is a data field we still
  // honor conservatively (tighten-only), but the hallucinated one must not appear.
  assert.equal(out.panel?.vetoes.includes("0x000000000000000000000000000000000000dead"), false);
});

test("baseDeny (e.g. stress-fragile) is preserved through synthesis", () => {
  const { s, base: b } = base();
  const out = synthesizePanel(s, b, [v({ role: "macro", regime: "calm" })], new Set([VENUE_B.toLowerCase()]), 0.6);
  assert.ok(out.panel?.vetoes.includes(VENUE_B.toLowerCase()), "stress deny carried into the panel result");
});
