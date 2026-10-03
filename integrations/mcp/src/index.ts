#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAgentApi } from "./agentApi.js";
import { createChainReader } from "./chain.js";
import { loadSettings } from "./config.js";
import { createAumoServer, SERVER_NAME, SERVER_VERSION, type Deps } from "./server.js";

// Entry point. stdio by default (what Claude Desktop, Claude Code and most MCP clients spawn).
// `--http --port N` serves the same tools over Streamable HTTP at POST /mcp instead.
// stdout carries the MCP protocol in stdio mode, so every log line goes to stderr.

const HELP = `aumo-mcp ${SERVER_VERSION}: Aumo treasury tools for AI agents over MCP.

Usage:
  aumo-mcp                          stdio transport (default)
  aumo-mcp --http [--port 3333] [--host 127.0.0.1]
                                    Streamable HTTP transport at POST /mcp

Environment:
  AGENT_URL   Aumo agent API (default https://aumo-production.up.railway.app)
  RPC_URL     X Layer RPC (default https://rpc.xlayer.tech)

No keys are read or needed. The server never signs or broadcasts transactions.`;

const log = (msg: string) => process.stderr.write(`[${SERVER_NAME}-mcp] ${msg}\n`);

function readJson(req: IncomingMessage, cap = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > cap) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function startHttp(deps: Deps, host: string, port: number) {
  const http = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, name: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }
    if (url.pathname !== "/mcp") {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      // Stateless mode: no server-initiated streams or sessions to resume or delete.
      res.statusCode = 405;
      res.setHeader("allow", "POST");
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
      return;
    }
    // A fresh server and transport per request keeps every call independent (stateless).
    const server = createAumoServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      const body = await readJson(req);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log(`request failed: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Bad request." }, id: null }));
      }
    }
  });
  http.listen(port, host, () => log(`Streamable HTTP on http://${host}:${port}/mcp`));
  return http;
}

async function main() {
  const { values } = parseArgs({
    options: {
      http: { type: "boolean", default: false },
      port: { type: "string", default: "3333" },
      host: { type: "string", default: "127.0.0.1" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const settings = loadSettings();
  const deps: Deps = { api: createAgentApi(settings.agentUrl), chain: createChainReader(settings.rpcUrl) };

  if (values.http) {
    const port = Number(values.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid --port ${values.port}`);
    startHttp(deps, values.host, port);
    return;
  }

  const server = createAumoServer(deps);
  await server.connect(new StdioServerTransport());
  log(`ready on stdio (agent ${settings.agentUrl}, rpc ${settings.rpcUrl})`);
}

main().catch((e) => {
  log(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
