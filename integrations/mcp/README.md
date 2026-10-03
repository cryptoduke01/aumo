# Aumo MCP server

An MCP server that lets any AI agent use Aumo as its treasury. An agent can check what Aumo is doing, read the reasoning behind every decision, look up a wallet's position, and get ready-to-sign transactions that move idle USDT0 into the Aumo pool on X Layer and back out when it needs to pay for something.

It works with Claude Desktop, Claude Code, OKX OnchainOS agents, and any other client that speaks the Model Context Protocol.

The server never holds keys, never signs, and never broadcasts. Deposit and withdraw tools return unsigned transactions. The calling agent's own wallet reviews, signs, and sends them.

## Tools

| Tool | What it returns |
| --- | --- |
| `aumo_status` | Whether the agent is online, decisions recorded (rebalanced vs held), current regime, time of the last decision, and the pool's total assets. |
| `aumo_venues` | Venues the agent can allocate into, with APY, risk-adjusted APY, risk score and band, allowlist status, and how much of the pool sits in each. |
| `aumo_decisions` | Recent decisions, newest first, with regime, summary, moves, and transaction links. Filter by `all`, `moved`, or `held`. |
| `aumo_replay_decision` | The full reasoning behind one decision: risk scores, stress test, reflection, panel verdicts, critic, planned moves, and what was executed. |
| `aumo_ask` | Ask the agent a question in plain language. Pass a wallet address for answers about that wallet's position. |
| `aumo_position` | A wallet's pool shares, share of the pool, and USDT0 redeemable now, read on-chain, plus its USDT0 balance and allowance to the pool. |
| `aumo_prepare_deposit` | Unsigned transactions to deposit USDT0: an exact-amount approve when the allowance is short, then the deposit. |
| `aumo_prepare_withdraw` | An unsigned transaction to withdraw a USDT0 amount, or `max` to redeem the whole position, with a dry run against the current chain state. |

Every prepared transaction has `to`, `data`, `value` (always `"0"`), `chainId` (196), `from`, and a plain summary of what it does.

## Install

Requires Node 20 or newer.

```bash
cd integrations/mcp
npm install
npm run build
```

This produces `dist/index.js`. In the snippets below, replace `/path/to/aumo` with the absolute path to your checkout.

## Configure a client

### Claude Desktop

Add this to `claude_desktop_config.json` (on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`), then restart Claude Desktop.

```json
{
  "mcpServers": {
    "aumo": {
      "command": "node",
      "args": ["/path/to/aumo/integrations/mcp/dist/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add aumo -- node /path/to/aumo/integrations/mcp/dist/index.js
```

Add `--scope user` to make it available in every project. To point at a different RPC, pass it as an env var:

```bash
claude mcp add aumo -e RPC_URL=https://rpc.xlayer.tech -- node /path/to/aumo/integrations/mcp/dist/index.js
```

### Any other MCP client

Over stdio, run the same command:

```bash
node /path/to/aumo/integrations/mcp/dist/index.js
```

Over HTTP, start the server with `--http` and point the client at `/mcp`:

```bash
node /path/to/aumo/integrations/mcp/dist/index.js --http --port 3333
# Streamable HTTP endpoint: http://127.0.0.1:3333/mcp
```

The HTTP mode is stateless (each POST is handled on its own) and binds to `127.0.0.1` by default. Use `--host 0.0.0.0` only behind something you trust. A client that takes a URL, such as Claude Code, can use it directly:

```bash
claude mcp add --transport http aumo http://127.0.0.1:3333/mcp
```

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_URL` | `https://aumo-production.up.railway.app` | The Aumo agent's public API. |
| `RPC_URL` | `https://rpc.xlayer.tech` | X Layer RPC for on-chain reads and dry runs. |

The pool (`0x8a98A4A868e5FBAc05B9d1dC0742BD008354114F`) and USDT0 (`0x779Ded0c9e1022225f8E0630b35a9b54bE713736`) addresses are the X Layer mainnet deployment the web app uses. No key, token, or secret is read or needed.

## How the treasury flow works

1. `aumo_position` with the agent's wallet shows what it already holds and its USDT0 balance.
2. `aumo_prepare_deposit` returns the approve (if needed) and deposit transactions. The agent's wallet signs and sends them in step order, waiting for each to confirm.
3. While funds sit in the pool, `aumo_status`, `aumo_venues`, and `aumo_decisions` show where they are and why.
4. When the agent needs to pay, `aumo_prepare_withdraw` returns the withdrawal. Withdrawals are never paused on the pool.

The dry run on a withdrawal uses `eth_call` from the owner's address. If part of the pool is in a fixed-term venue (Pendle PT), an amount close to the full marked value can revert before maturity. The tool says so, and `max` redeems all shares at realizable value instead.

## Development

```bash
npm test            # unit and in-memory MCP tests (node:test), no network
npm run typecheck   # tsc --noEmit
npm run smoke       # starts the server over stdio and calls aumo_status and aumo_venues live
npm run smoke -- --all   # calls every tool live (aumo_ask sends one real question)
npm start           # run from source with tsx
```

Test fixtures in `test/fixtures` are real responses captured from the live agent API.
