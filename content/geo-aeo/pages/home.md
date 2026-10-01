# Home — lower half「Darkroom Catalogue」+ AEO hub

**URL:** https://www.jdstudiohk.com/  
**Lower block:** `home-lower.squarespace-codeblock.html` (`#jdh`)  
**UX brief:** `home-lower.ux.md`  
**Direction:** dark gallery wall with museum labels (not a Visual Department clone)

## Page role
Entity hub: one citable「是…」definition, image-led links to all 8 services, light price anchors, WhatsApp close.

## Recommended page structure
1. Existing Squarespace hero (showreel), keep
2. Optional「我們的信念」／partners, keep or trim
3. **Lower Code Block** (`#jdh`), section background `#050507`
4. Footer, keep

## Lower-half sections
1. Statement:「影像，令品牌被記住。」+「JD Studio 是香港專業商業攝影及影片製作公司，2014 年成立，於九龍新蒲崗自設影樓。」
2. Service wall: strict 4×2 (2×4 under 700px), equal 4:5 frames, caption = name + one price line
3. FAQ (3): 收費／影樓位置／如何查詢
4. Close: 有拍攝計劃？ + WhatsApp 免費報價 + 聯絡我們

## SEO / AEO
- Prefer page H1 in Squarespace: `JD Studio 香港商業攝影`
- Definition stays visible HTML text; tile names are H3 links to each service URL
- Prices only from published pages/blogs (see table in `home-lower.ux.md`); party/jewelry/menu show 按時段／按件／按項目報價
- FAQ price answer mirrors the tile lines; keep any home FAQPage JSON-LD in sync if added
- Swap tile images via Squarespace CDN URLs; tune crops with the per-tile `--p/--z/--o/--b` vars
