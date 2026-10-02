# Homepage lower half — "Darkroom Catalogue"（暗房目錄）

**Block:** `home-lower.squarespace-codeblock.html` (`#jdh`)

## Rules
- No prices on homepage tiles / FAQ
- **Own work only** — JD Studio portfolio frames (Squarespace CDN; food crab hosted from repo until uploaded to Asset Library)
- Strict 4×2 wall, 4:5 cover crop, shared CSS grade
- Preserve palette: `#050507` / gold `#c9a962` / Noto Sans TC — not a dashboard

## Tile sources
| Service | File |
|---|---|
| 產品攝影 | `A7R06570.jpg` (porcelain vase) |
| 食物攝影 | `food-crab.jpg` (user ref #2 — crab banquet; jsDelivr until Squarespace upload) |
| 室內攝影 | `A7R00140.jpg` (Busy Bee boutique) |
| 珠寶攝影 | `2101+A1.jpg` (diamond ring) |
| 企業活動 | `DSC02693.jpg` (Cathay signing handshake) |
| 影片／TVC | `video-bts.jpg` (Behind the Scenes cinema rig; jsDelivr until Squarespace upload) |
| 派對活動 | `DSC04196.jpg` (family celebration cake) |
| 餐牌設計 | hotel dessert (`4酒店…`) |
| Close | `AKE_Cariam-2-Product-Shot-0324.jpg` |

## Journey
1. Statement + short definition  
2. Subtle wayfinding: 服務 · 常見問題 · 查詢  
3. Service wall — name only  
4. FAQ ×3 (booking / location / start)  
5. WhatsApp close  

## UX notes (UI pass)
- **Loading:** `.ph::before` shimmer skeleton; fades when `.is-ready` (minimal JS on img load/error)
- **Feedback:** tile hover dim-siblings + gold underline; `:active` press scale; CTA hover lift + darker press
- **Hierarchy:** display statement → gold section labels → FAQ secondary → CTA destination
- **Nav:** intro `.way` anchors only — not a sticky app bar; `is-active` via IntersectionObserver; section `scroll-margin`
- **CTA copy:** concrete action —「WhatsApp 查詢報價」
- **a11y:** stronger muted contrast (`--mut`/`--dim`); `aria-label` on tiles; 2px gold `focus-visible`; `prefers-reduced-motion` kills shimmer/transforms
- **Whitespace:** slightly tighter vertical rhythm between sections; even tile/caption gaps

## Squarespace
One Code Block; section background `#050507`.  
Optional: upload `content/geo-aeo/assets/home-tiles/food-crab.jpg` to Asset Library and swap the food tile `src` to the Squarespace CDN URL.
