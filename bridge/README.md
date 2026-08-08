# Aumo bridge

Moves USDT0 onto X Layer from any supported chain, so a depositor on Ethereum, Arbitrum,
Optimism, or Polygon can fund Aumo without manual bridging.

It uses USDT0's **native LayerZero OFT** — the canonical path for the asset — not a third-party
bridge. USDT0 is an omnichain token backed 1:1, so the amount that leaves the source chain is the
amount that lands on X Layer.

## How it works

1. Pick a source chain and amount.
2. `quote` reads the LayerZero fee and confirms the route resolves (read-only, no funds moved).
3. `send` approves the OFT if required, then calls `send()` on the source-chain OFT with the X Layer
   endpoint id (30274) and your recipient. LayerZero delivers USDT0 to X Layer.

The recipient defaults to the vault owner, so bridged funds arrive ready to deposit into the vault.

## Run

```bash
npm install
cp .env.example .env      # set SOURCE_CHAIN, RECIPIENT

npm run quote 100         # quote bridging 100 USDT0 to X Layer — safe, read-only
SEND=1 npm run send 100   # execute (needs a funded PRIVATE_KEY on the source chain)
```

## Supported source chains

| Chain | LZ EID | USDT0 OFT |
| --- | --- | --- |
| Ethereum | 30101 | `0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee` |
| Arbitrum One | 30110 | `0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92` |
| Optimism | 30111 | `0xF03b4d9AC1D5d1E7c4cEf54C2A313b9fe051A0aD` |
| Polygon PoS | 30109 | `0x6BA10300f0DC58B7a1e4c0e41f5daBb7D7829e13` |

Destination: X Layer (EID 30274), USDT0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`.

## Auto-deposit on arrival

Bridging to the vault owner lands funds on X Layer ready to deposit. Fully automatic
deposit-on-arrival (LayerZero compose calling the vault directly) needs a small on-chain composer
and depends on whether the vault stays single-owner or becomes multi-depositor — see the open design
note in the repo.

## Safety

- `quote` is read-only. `send` refuses unless `SEND=1` and a `PRIVATE_KEY` is set.
- Never commit a funded key. The `.env` is gitignored.
