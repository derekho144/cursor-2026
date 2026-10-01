# Homepage lower half — "Darkroom Catalogue"（暗房目錄）

**Block:** `home-lower.squarespace-codeblock.html` (`#jdh`)  
**Replaces:** v2 visual-first mosaic (client feedback:「好核突」)

## Why v2 felt 核突
1. **Assets sabotaged the grid** — 3 of 8 tiles were not photographs: TVC = NIP calligraphy logo on white, 派對 = photo-booth flyer with text, 室內 = screenshot with Hang Lung logo mid-frame.
2. **Mosaic without logic** — 7/5/4/7 column spans gave every tile a different ratio; crops were random (one tile cropped straight onto the logo).
3. **Five labels per tile** — number + ZH + EN caps + hover line + gold price sticker over a dark scrim. Gold chips read as supermarket tags.
4. **Second hero under the hero** — 5rem bold display with negative CJK tracking, then a run-on list of 7 services that repeated the grid below it.
5. **Six bolted-on modules** — filmstrip (same categories again), floating stats row, 760px left-hung FAQ, busy bright CTA photo; each had its own grid and alignment.

## Art direction
Prints hung in a dark room, with a museum label under each one.
- Words never sit on photos. Each photo gets one quiet label underneath.
- One frame ratio (4:5), strict 4×2 wall, generous gutters; every section sits on the same 12-column grid.
- Gold = action only: tiny section labels, hover hairline, FAQ open state, WhatsApp button. No chips, no glows.
- Light-weight CJK display (300, `palt`, +0.02em), phrases kept whole with `.nw`.
- No eyebrow, no EN duplicates, no entrance animation (block is below the fold); hover = 1.04 zoom + sibling dim.

More refined than Visual Department (no condensed caps shouting over scrims); more premium than an SMB brochure (no badges, no sticker prices, no mosaic).

## Journey (one job per section)
1. **Statement** — 「影像，令品牌被記住。」left; the「是…」definition right, baseline-aligned.
2. **Service wall** — 8 equal tiles: name + one price line. All 8 service links kept.
3. **FAQ** — sidehead label + 3 questions (plain +/×, no circles).
4. **Close** — headline + WhatsApp button left, one calm framed photo right.

Removed: filmstrip, stats row (2014／新蒲崗 now inside the definition), EN small caps, index numbers, hover lines, price chips, radial glow, load animations.

## Price line (published anchors only)
| Tile | Line |
|---|---|
| 產品攝影 | HK$150 起／張 |
| 食物攝影 | HK$3,000 起 |
| 室內攝影 | HK$2,500 起 |
| 珠寶攝影 | 按件報價 |
| 企業活動 | HK$3,000 起 |
| 影片／TVC | HK$20,000 起（TVC blog band） |
| 派對活動 | 按時段報價（v2's HK$3,000 was the corporate figure） |
| 餐牌設計 | 按項目報價 |

## Assets
- Same JD CDN library as v2, re-cast: the logo/flyer tiles are dropped; filmstrip frames now fill 影片 (east dessert still), 派對 (ZA opening, logo cropped out) and 餐牌 (Marco Polo). Close uses the driftwood still.
- 室內 uses a 2× crop of the existing frame (lamp + lacquer + oak), so the Hang Lung logo is never shown.
- Per-tile crop vars: `--p` object-position · `--z` zoom · `--o` zoom origin · `--b` brightness (bright event frames at .9).
- PNG-sourced food frames load at 1000w／750w (lossless WebP from CDN is heavy); interior at 2500w for the 2× crop.
- **Swap when available:** a clean, logo-free interior frame and a real film still for 影片／TVC (one `src` each).

## Squarespace paste
- One Code Block; section background `#050507`, section padding minimal (block has its own rhythm).
- Page H1 stays in Squarespace; block uses H2/H3.
- Scoped resets keep site heading/link/list styles out (tested against serif uppercase H2, red links, bullets: identical render).
