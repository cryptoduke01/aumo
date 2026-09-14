# Stocks venues on X Layer (chain 196) — deployment reference

How xStocks actually trade on X Layer, resolved and verified on-chain 2026-09-14.

## The structure

The raw xStock (e.g. NVDAx) is restricted and has no DEX liquidity. Each has a freely
transferable **wrapped** ERC-20 (`w<SYM>x`, 18 decimals, `asset()` = the raw xStock) that
carries all the Uniswap V3 liquidity. The OKX DEX router (`dagSwapTo`) just orchestrates the
wrap plus the multi-hop; we do not need it. Our v3 path-agnostic `EquityAdapter` routes directly.

**Route:** `USD₮0 -> USDG -> w<SYM>x`, both hops on Uniswap V3.
- Hop 1: USDG/USD₮0 pool `0x0cbe0dbe1400e57f371a38bd3b9bc80f7c3676da`, fee 100 (0.01%), ~$5.36M deep.
- Hop 2: `w<SYM>x`/USDG pool, fee 500 (0.05%), depth varies per stock (below).

Base/quote (verified, 6dp): USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`, USDG
`0x4ae46a509f6b1d9056937ba4500cb143933d2dc8`. Uniswap V3 factory `0x4B2ab38DBF28D31D467aA8993f6c2585981D6804`.

## The catalog (all verified: symbol, asset()=raw xStock, fee-500 USDG pool)

Ranked by USDG-side depth (rough; multiply by ~2 for pool TVL). Price via the self-hosted
Finnhub oracle (w<SYM>x tracks the underlying share ~1:1).

| Stock | wrapped token (`w<SYM>x`) | w/USDG pool (fee 500) | USDG depth | Launch tier |
|-------|---------------------------|-----------------------|-----------|-------------|
| NVDA  | `0xa8ddb5cd96b5222afe198316e9a57caa642850d5` | `0x2a2B11730C2b6d99a58034A869dd810D7300a7b2` | ~$210K (~$640K TVL) | ready |
| AAPL  | `0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f` | `0xc44bd9c8589026D28D1632d7b86b2Efb6cDc8fd2` | ~$217K | ready |
| MSFT  | `0x166fbe68274b6a47e025f4ba17388c539f1fa1d0` | `0x66187278490a70A8aC26a6E159EB045F82DbFb57` | ~$157K | ready |
| META  | `0xe840946ffebcd66b7c4e95095effafadfa0d0e56` | `0xfAD9e3C7550768fd4f34Bc9CEFD365CC193C0fB0` | ~$127K | ready |
| AMZN  | `0x910cabde3eba7fc1ce64fd14bd680b9f60fa0f90` | `0x8C1C0d559D1C7AE6ed921cC77abd0f26aC2FE59a` | ~$26K  | marginal |
| TSLA  | `0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171` | `0xe1071DB4691b325c709854DC3D5CcD5d77e62Ed1` | ~$13K  | marginal |
| GOOGL | `0xf8c5308f80e459bb53d9ebe689854d9cbb2caa6f` | `0x8CE66218A6310765307e7ab2d11BcfF7cC2ea1F1` | ~$0.6K | too thin |
| COIN  | `0x44c7ed7ffdf8465c9d27f60aec845eed3d49d56e` | `0xFD69Fd884BD7c35DF86D2eC80ae74Cbe774C00ab` | ~$0.07K | too thin |

Shared OKX settlement contracts seen in swaps (not needed by us): `0x092b82d830f1dabcefcc2b4a4226d17e76116477`,
`0x09fc9b7545020f6a51d113e495e0a451597969d3`; OKX DEX router `0x7c5bee2a8091c3ef39072f64f18fac913060aeaf`.

## To wire the adapter (per stock)

- stock token = `w<SYM>x`; buyPath = `USD₮0 ->(100)-> USDG ->(500)-> w<SYM>x`; sellPath = reverse.
- oracle = SelfHostedEquityOracle fed by Finnhub (feedId per underlying symbol).
- size `slippageBps` for two hops and the per-stock depth (tighter is safe on the deep four).

## DEPLOYED on X Layer mainnet (2026-09-14, block ~70650286)

Shared oracle + the four launch pools, from `DeployStocksMainnet.s.sol` (owner 0x9471A4…96AE).

- **SelfHostedEquityOracle:** `0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2`
- **owner = agent = updater:** `0x9471A4ea01f51d01749D9E9696b973faf27a96AE` (EQUITY_AGENT was not set, so it defaulted to owner; repoint to a hot agent key before running the feeder/executor autonomously — see below).

| Stock | EquityPool | EquityAdapter |
|-------|------------|---------------|
| NVDA  | `0x42ee28ADcA2323689f9c5c8f733B9F56fbb4F7aA` | `0x63D4787ee4f9398A2A22A06B9F0f0f9f1f53Ee94` |
| AAPL  | `0xD66a4473C4b81397A090248d05179b7da04993d0` | `0xF78F84A4CE4A72802F4A1B672E1e4e1680226b9e` |
| MSFT  | `0xEE9Cfb0D6847BbC546E0c11538816Ea1f3DAf870` | `0xD4b3CF075E6Fb749Cb6e2eCb2885B86AAC8b21D8` |
| META  | `0xC70881EE201FB6979f90CF39A690D6816BB30463` | `0x87615aeB27Eb030F22526ac4277b6868485A5cf3` |

Feeder/executor env (aligned lists):
```
EQUITY_SYMBOLS=NVDA,AAPL,MSFT,META
EQUITY_POOLS=0x42ee28ADcA2323689f9c5c8f733B9F56fbb4F7aA,0xD66a4473C4b81397A090248d05179b7da04993d0,0xEE9Cfb0D6847BbC546E0c11538816Ea1f3DAf870,0xC70881EE201FB6979f90CF39A690D6816BB30463
EQUITY_VENUES=0x63D4787ee4f9398A2A22A06B9F0f0f9f1f53Ee94,0xF78F84A4CE4A72802F4A1B672E1e4e1680226b9e,0xD4b3CF075E6Fb749Cb6e2eCb2885B86AAC8b21D8,0x87615aeB27Eb030F22526ac4277b6868485A5cf3
SELF_HOSTED_EQUITY_ORACLE=0x1759B50019C988F3eF4Cc0F4879d80EdaD2Ec4D2
```
Until the feeder submits the first prices, every pool reads market-closed and deposits are gated shut. That is expected; the first feeder cycle opens them.

## Before mainnet

- Confirm USD₮0 `0x779ded…3736` is the same asset the live safe pool uses (it is the base for the equity pool too).
- Start with the four "ready" stocks (NVDA, AAPL, MSFT, META). Hold AMZN/TSLA for more depth; skip GOOGL/COIN until liquidity arrives.
- Confirm `w<SYM>x` wrap ratio is ~1:1 to the share and that holding the wrapped token (not unwrapping) is fine (it is the liquid token). Fork-test a full round trip on live X Layer.
