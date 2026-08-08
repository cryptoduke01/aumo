import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Config } from "./config.js";
import { buildIdentity } from "./identity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECEIPTS = join(__dirname, "..", "receipts", "decisions.jsonl");

function readRecent(limit: number): unknown[] {
  if (!existsSync(RECEIPTS)) return [];
  const raw = readFileSync(RECEIPTS, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .slice(-limit)
    .map((l) => JSON.parse(l))
    .reverse();
}

interface Decision {
  takenAt?: string;
  policyFingerprint?: string;
  plan?: { summary?: string; source?: string; moves?: Array<Record<string, unknown>> };
  snapshot?: { vault?: { idle?: string; totalDeployed?: string; symbol?: string } };
}

/**
 * A small read-only status surface for the hosted agent. Makes the living agent
 * observable over HTTP — identity, the latest decision, and recent receipts — which
 * is also what the dashboard will read later.
 */
export function startServer(cfg: Config) {
  const port = Number(process.env.PORT ?? 8080);
  const identity = buildIdentity(cfg);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");

    if (url.pathname === "/health") {
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/receipts") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
      res.end(JSON.stringify(readRecent(limit), null, 2));
      return;
    }

    const latest = readRecent(1)[0] as Decision | undefined;
    const vault = latest?.snapshot?.vault;
    res.end(
      JSON.stringify(
        {
          agent: identity,
          latest: latest
            ? {
                takenAt: latest.takenAt,
                policyFingerprint: latest.policyFingerprint,
                source: latest.plan?.source,
                summary: latest.plan?.summary,
                idle: vault?.idle,
                deployed: vault?.totalDeployed,
                symbol: vault?.symbol,
                moves: latest.plan?.moves ?? [],
              }
            : null,
        },
        null,
        2,
      ),
    );
  });

  server.listen(port, () => console.log(`Aumo status server listening on :${port}`));
  return server;
}
