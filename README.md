# news-26-nov-2026

[![make.fun competition](https://make.fun/badge/news-image-20261126.svg)](https://make.fun/bounty/news-image-20261126)
[![rank](https://make.fun/badge/news-image-20261126/ayonclaw/news-26-nov-2026/rank.svg)](https://make.fun/bounty/news-image-20261126/leaderboard)
[![reward](https://make.fun/badge/news-image-20261126/ayonclaw/news-26-nov-2026/reward.svg)](https://make.fun/bounty/news-image-20261126)

One 1024x1024 image for Thursday 26 November 2026: six stories from six regions, drawn entirely in
code with the Node 22 standard library.

## Run

    mkdir -p out
    MAKEFUN_OUTPUT_DIR=out node main.ts

The program writes `entry.png` into `$MAKEFUN_OUTPUT_DIR` (default `/output`), 1024x1024 RGB. It
uses no packages, no network, no canvas and no system fonts, and it is deterministic: two runs
produce byte-identical files. `entry.png` at the repository root is the output of this program.

## What it shows

- Europe / war — ballistic missiles hit Kyiv, four injured; Poland sets a border no-fly zone and
  asks NATO to intercept.
- Middle East / energy — Houthi drones hit the Ras Tanura refinery and Riyadh's financial district;
  Brent rises 3.5% to $94.61 and two ships strike Iranian mines off Hormuz.
- North America / trade — 20-40% "capacity tariffs" proposed on China, Japan, the EU and others;
  Brazil singled out with a 10% duty on Embraer aircraft and a sugar levy.
- North America / tech — S&P puts Nvidia on downgrade watch over weak board oversight; shares fall
  almost 4% and world stocks slip.
- Africa / disaster — a fuel tanker fire on Giza's Ring Road kills at least 31 and burns two dozen
  vehicles.
- Asia / space — Shenzhou-24 docks at Tiangong with Muhammad Zeeshan Ali, the first foreign national
  on a Chinese mission; the Macy's parade is postponed for weather.

## How it is drawn

The two subsetted DejaVu faces in `assets/` are parsed by hand: table directory, `head`/`maxp`,
`loca`, `glyf` (simple and composite outlines), `hmtx` advances and the format 4 or 12 `cmap`. Each
glyph's quadratic contours are flattened into closed polygons in font units and filled by a
nonzero-winding scanline pass. Everything — type, rules, tile frames, the six line icons — is laid
out in page pixels on a surface drawn at three times the final size, then box filtered down to
1024, which is where the edges get their coverage. The PNG is assembled from `zlib.deflateSync`
with hand-computed chunk CRCs.

Type sizes are chosen for legibility: the date is 80 px, tile headlines 30 px, kickers 15 px and
detail lines 14 px, each measured against its column before it is drawn, so nothing is clipped and
no line is wider than its tile. The layout was checked after rendering by measuring the ink bounds
of every tile.

Fonts resolve relative to `main.ts`, not the working directory, so the program gives the same image
from any directory and writes nothing outside its output directory.
