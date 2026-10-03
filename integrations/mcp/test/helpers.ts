import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StatusResponse, DecisionRecord } from "../src/types.js";

// Fixtures are real responses captured with curl from the live agent API
// (https://aumo-production.up.railway.app) on 2026-10-03:
//   status.json            GET /
//   receipts-latest.json   GET /receipts?limit=3           (three holds)
//   receipts-moved.json    GET /receipts?limit=3&offset=699 (the last one moved funds into Pendle)
//   decisions-excerpt.csv  header plus 8 rows of GET /receipts.csv, including rebalanced rows

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export const fixtureText = (name: string) => readFileSync(join(dir, name), "utf8");
export const fixtureJson = <T>(name: string): T => JSON.parse(fixtureText(name)) as T;

export const statusFixture = () => fixtureJson<StatusResponse>("status.json");
export const latestReceipts = () => fixtureJson<DecisionRecord[]>("receipts-latest.json");
export const movedReceipts = () => fixtureJson<DecisionRecord[]>("receipts-moved.json");
export const movedRecord = () => {
  const r = movedReceipts().find((d) => (d.plan?.moves?.length ?? 0) > 0);
  if (!r) throw new Error("fixture receipts-moved.json has no moved decision");
  return r;
};
