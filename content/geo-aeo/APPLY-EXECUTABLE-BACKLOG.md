# Apply executable AEO backlog (Squarespace via Manus)

**Goal:** Close live Growth「內容與 AEO 缺口」for service pages missing Service / Offer / definition / FAQ signals.

**Do not** touch `/services/interior-photography` or `/services/jewelry-photography` (already live-complete).  
**Do not** publish `jdsys.biz` for this workstream.

## Paste map (GitHub `main` → `content/geo-aeo/`)

| Live URL | Code Block | Header Code Injection |
|---|---|---|
| `/services/product-photography` | `product-photography.squarespace-codeblock.html` | `product-photography.schema.jsonld.html` |
| `/services/food-photography` | `food-photography.squarespace-codeblock.html` | `food-photography.schema.jsonld.html` |
| `/services/corporate-event` | `corporate-event.squarespace-codeblock.html` | `corporate-event.schema.jsonld.html` |
| `/services/event-photography` | `event-photography.squarespace-codeblock.html` | `event-photography.schema.jsonld.html`（若 codeblock 已含 schema 則唔重複） |
| `/services/art-photography` | `art-photography.squarespace-codeblock.html` | `art-photography.schema.jsonld.html` |
| `/-menu-design` | `menu-design.squarespace-codeblock.html`（更新定義「是專門」） | `menu-design.schema.jsonld.html` |
| `/services/video-project` | `video-project.squarespace-codeblock.html` | `video-project.schema.jsonld.html` |
| `/services/gallery` | `gallery-ai.squarespace-codeblock.html` | `gallery-ai.schema.jsonld.html` |

## Per page
1. Open Squarespace editor for the URL  
2. Paste Code Block near top of body（保留現有 portfolio／hero）  
3. Paste schema into Page Settings → Advanced → Header Code Injection  
4. Save → **Publish**  
5. View-source 確認有 `"@type":"Service"` 與 `"@type":"Offer"`（或 OfferCatalog），以及可見「常見問題」

## Acceptance
- `是專門`／`專門提供` 定義句可見  
- 可見 FAQ  
- Service + Offer schema  
- WhatsApp CTA  

## Out of scope this wave
- Ads Action Queue mutations（需 jdsys 登入批准 + Google Ads credentials）  
- FAQPage rich-result 依賴（2026 非必須；可見 FAQ 優先）
