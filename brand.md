# Brand — Aumo

_Status: interim_ — a restrained neutral system to build against now. The paid designer's final
palette and type will replace the values here and in `web/app/globals.css` in one pass. Keep every
color and font referencing the tokens below so the swap is a find-and-replace, not a rewrite.

## Feel

A private bank's composure with a software-native edge. Quiet, precise, grown-up. Dark-first.
Numbers, positions, and on-chain receipts are the product, so data is first-class. Not hype, not
degen. The bar: Ondo, Morpho, Kamino — editorial finance, not crypto-carnival.

"au" is the chemical symbol for gold; a single restrained gold accent is the only warm note.

## Palette (dark-first; these map to shadcn CSS variables)

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#0A0B0D` | app background, near-black, faintly warm |
| `--card` | `#101215` | panels, cards |
| `--foreground` | `#EAE8E3` | primary text, warm off-white |
| `--muted-foreground` | `#8A8F98` | secondary text, labels |
| `--border` | `#1E2126` | hairlines, dividers |
| `--primary` | `#C8A96A` | the gold accent — sparingly (key numbers, active state) |
| `--primary-foreground` | `#0A0B0D` | text on gold |
| `--positive` | `#5BB98B` | yield up, healthy |
| `--negative` | `#D98A76` | risk, retreat, off-peg |
| `--ring` | `#C8A96A` | focus ring |

Light mode: invert to a warm paper (`#F7F6F2` bg, `#14161A` text) with the same gold. Both themes
must pass WCAG AA.

## Typography

- **Sans (UI):** Geist (or Inter) via `next/font`.
- **Mono (numbers, addresses, hashes):** Geist Mono (or JetBrains Mono). All on-chain values,
  balances, APYs, and hashes render in mono — data is the product.
- Tight, editorial headings; generous line-height on body.

## Radius & surface

- Radius small-to-medium (`0.5rem`), not pill-round. Editorial, not bubbly.
- Flat surfaces, hairline borders, minimal shadow. Depth comes from subtle contrast, not drop shadows.

## Voice

Calm, specific, active. "Deployed 100 USDT0 into Aave at 5.8% risk-adjusted." Never "Click here to
see your amazing yields!". State facts and let the numbers carry it.
