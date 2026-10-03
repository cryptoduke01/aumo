import type { CsvDecision, DecisionRecord, StatusResponse } from "./types.js";

// Client for the hosted agent's public HTTP API (agent/src/server.ts). Read-only apart from /ask,
// which is a question, not an action. No auth: the API is public and this server holds no secrets.

export interface AgentApi {
  health(): Promise<boolean>;
  status(): Promise<StatusResponse>;
  /** Newest-first page: skip `offset` most recent, return the next `limit` (server caps at 100). */
  receipts(limit: number, offset?: number): Promise<DecisionRecord[]>;
  /** The full decision trail as parsed CSV rows, oldest first (file order). */
  decisionsCsv(): Promise<CsvDecision[]>;
  ask(question: string, address?: string): Promise<string>;
}

export class AgentApiError extends Error {}

const TIMEOUT_MS = 20_000;
const CSV_TTL_MS = 60_000;

export function createAgentApi(baseUrl: string, fetchImpl: typeof fetch = fetch): AgentApi {
  let csvCache: { at: number; rows: CsvDecision[] } | null = null;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new AgentApiError(`Aumo agent API unreachable (${path}): ${e instanceof Error ? e.message : String(e)}`);
    }
    return res;
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await request(path);
    if (!res.ok) throw new AgentApiError(`Aumo agent API ${path} returned HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async health() {
      try {
        const res = await request("/health");
        if (!res.ok) return false;
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        return body.ok === true;
      } catch {
        return false;
      }
    },

    status: () => getJson<StatusResponse>("/"),

    receipts: (limit, offset = 0) =>
      getJson<DecisionRecord[]>(`/receipts?limit=${Math.trunc(limit)}&offset=${Math.trunc(offset)}`),

    async decisionsCsv() {
      if (csvCache && Date.now() - csvCache.at < CSV_TTL_MS) return csvCache.rows;
      const res = await request("/receipts.csv");
      if (!res.ok) throw new AgentApiError(`Aumo agent API /receipts.csv returned HTTP ${res.status}`);
      const rows = csvToDecisions(await res.text());
      csvCache = { at: Date.now(), rows };
      return rows;
    },

    async ask(question, address) {
      const res = await request("/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(address ? { question, address } : { question }),
      });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (res.status === 429) throw new AgentApiError(data.error ?? "Rate limited by the Aumo agent. Wait a minute and retry.");
      if (!res.ok) throw new AgentApiError(data.error ?? `Aumo agent /ask returned HTTP ${res.status}`);
      return data.answer ?? "";
    },
  };
}

/**
 * RFC 4180 parser: quoted fields may contain commas, doubled quotes, and newlines. The agent's CSV
 * writer quotes exactly those cases (csvCell in agent/src/server.ts), so a naive split would break
 * on any rationale that contains a comma.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvToDecisions(text: string): CsvDecision[] {
  const rows = parseCsv(text.trim());
  const header = rows.shift();
  if (!header) return [];
  const col = (name: string) => header.indexOf(name);
  const idx = {
    takenAt: col("takenAt"),
    regime: col("regime"),
    appetite: col("appetite"),
    source: col("source"),
    action: col("action"),
    moveCount: col("moveCount"),
    movedInto: col("movedInto"),
    rationale: col("rationale"),
    txHashes: col("txHashes"),
  };
  if (idx.takenAt < 0 || idx.action < 0) throw new AgentApiError("Unexpected /receipts.csv header");
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
  return rows
    .filter((r) => r.length > 1 && at(r, idx.takenAt))
    .map((r) => ({
      takenAt: at(r, idx.takenAt),
      regime: at(r, idx.regime),
      appetite: at(r, idx.appetite),
      source: at(r, idx.source),
      action: at(r, idx.action),
      moveCount: Number(at(r, idx.moveCount)) || 0,
      movedInto: at(r, idx.movedInto),
      rationale: at(r, idx.rationale),
      txHashes: at(r, idx.txHashes),
    }));
}
