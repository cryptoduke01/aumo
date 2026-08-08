# Deploying the Aumo agent on Railway

The agent runs as a hosted service in `serve` mode: a status HTTP server plus the decision loop.
`agent/Dockerfile` and the `serve` command are ready. Deploy it into its **own** Railway project.

## 1. Refresh Railway auth

Provisioning (create project / service, connect source) needs a current login:

```bash
railway login
```

## 2. Create a dedicated project and service

```bash
railway init            # create a new project, e.g. "aumo"
railway add             # add a service, or link the GitHub repo cryptoduke01/aumo
```

If linking the GitHub repo, set the service **root directory** to `agent/` so Railway builds from
`agent/Dockerfile`.

## 3. Set variables

Non-secret:

```
RPC_URL=https://testrpc.xlayer.tech
CHAIN_ID=1952
CHAIN_NAME=X Layer Testnet
VAULT_ADDRESS=0x52Fc89beD432e068a0a837065fbCFaDb3573A55e
VENUES_FILE=testnet
RISK_APPETITE=moderate
MAX_CONCENTRATION=0.6
LOOP_INTERVAL_SECONDS=900
EXECUTE=0
```

Two you add yourself (keep them out of git and out of chat):

```
AGENT_PRIVATE_KEY=<the testnet throwaway key>     # only needed if EXECUTE=1
ANTHROPIC_API_KEY=<your key>                       # switches the reasoning layer on
```

Leave `EXECUTE=0` for an unattended hosted instance — it senses, scores, reasons, and records
without moving funds. Flip to `EXECUTE=1` (with the agent key set) when you want it to act.

Railway injects `PORT`; the status server binds to it automatically.

## 4. Expose it

Generate a domain for the service. Then:

- `GET /health` → `{ "ok": true }`
- `GET /` → identity card + latest decision (summary, rationale, policy fingerprint, balances)
- `GET /receipts?limit=20` → recent decision records

This status surface is also what the dashboard will read later.

## Note on receipts persistence

Receipts are written to `/app/receipts` inside the container, which is ephemeral. For a durable
history, mount a Railway volume at `/app/receipts`.
