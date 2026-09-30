# Sitewide AEO / GEO Playbook — jdstudiohk.com

**Goal:** Make Google AI Overview / AI Mode / ChatGPT-style answer engines cite **JD Studio** for commercial photography keywords in Hong Kong.

**Primary keywords (money):** 產品攝影、食物攝影、珠寶攝影、室內攝影、企業活動攝影、派對活動攝影、TVC／企業影片、菜單設計、AI 商業產品影像

**CMS:** Squarespace (`www.jdstudiohk.com`) — **not** `jdsys.biz`.

---

## 1. What wins AEO/GEO (2025–2026)

| Signal | Why it matters | JD Studio rule |
|---|---|---|
| **Citable definition** in first viewport | AI Overview often opens with「X 是…」 | Every service page: first visible paragraph starts with `{服務}是專門／是一項…` |
| **Visible facts table** (price / scope / deliverables) | Models prefer structured, quotable numbers | Not only FAQ accordion — add a visible「收費參考」table |
| **FAQPage JSON-LD** matching visible Q&A | Powers rich results + answer extraction | ≥5 FAQs; Q1 = definition, Q2 = pricing |
| **Service + Offer schema** | Ties brand → service → price | `minPrice` in HKD; link `provider` LocalBusiness |
| **Clean H1 = primary keyword** | Entity clarity | H1 = `香港{服務}`；副標放差異化（AI／交付／器材） |
| **Meta description with numbers** | Citation anchors | Include 1–3 price anchors already published on site/blog |
| **Internal links** service ↔ pricing blog | Reinforces topical authority | Each service page links to its pricing guide blog |
| **E-E-A-T** | Trust for YMYL-ish commercial queries | Keep real clients, years, WhatsApp, address |

**Do not:** keyword-stuff; invent fake prices/reviews; redesign whole site; publish `jdsys.biz` for this workstream.

---

## 2. Audit snapshot (2026-09-22)

Legend: ✅ strong · 🟡 partial · ❌ weak

| Page | Def lead | Visible $ | FAQ UI | FAQPage | Service | Offer | Priority |
|---|---|---|---|---|---|---|---|
| `/services/interior-photography` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Done (template) |
| `/` home | ❌ no H1 | ❌ | 🟡 | ✅ | ✅ | ✅ | P1 |
| `/services/product-photography` | 🟡 | 🟡 (meta/FAQ) | ✅ | ✅ | ✅ | ❌ | **P0** |
| `/services/food-photography` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | **P0** |
| `/services/jewelry-photography` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | **P0** |
| `/services/video-project` | ❌ | ❌ | ❌ | ❌ | 🟡 | ❌ | **P0** |
| `/services/corporate-event` | 🟡 | ❌ | ✅ | ✅ | ✅ | ❌ | P1 |
| `/services/event-photography` | 🟡 | ❌ | 🟡 | ✅ | ✅ | ❌ | P1 |
| `/services/art-photography` | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | P2 |
| `/services/gallery` (AI) | ❌ | ❌ | 🟡 | ✅ | ✅ | ❌ | P1 |
| `/-menu-design` | ❌ | ❌ | 🟡 | ❌ | ❌ | ❌ | P1 |
| `/contact-us` | — | — | ❌ | ❌ | ❌ | — | P2 |
| Pricing **blogs** | ✅ | ✅ | ✅ | ✅ | — | — | Keep + cross-link |

Interior page is the **gold template**. Copy its pattern (definition + pricing grid + FAQ + Offer schema).

---

## 3. Sitewide standards (every indexable page)

### 3.1 SEO fields (Squarespace Page Settings)
- **Title:** `香港{主關鍵字}｜{差異化／收費}｜JD Studio` (≤60 chars where possible)
- **Description:** 1 definition clause + 1–3 price anchors + CTA (WhatsApp／免費報價)
- **URL:** keep existing slugs (do not rename)

### 3.2 On-page blocks (order)
1. H1 = primary keyword  
2. Subhead = audience / use cases  
3. **Definition paragraph** (citable)  
4. **服務與收費參考** table (visible)  
5. Portfolio / process / proof (existing — keep)  
6. FAQ (≥5), Q1 definition, Q2 pricing  
7. CTA WhatsApp  

### 3.3 JSON-LD (page Code Injection or Code Block)
Minimum `@graph` entities:
- `WebPage`
- `Service` (name, description, provider, areaServed, url)
- `Offer` / `OfferCatalog` (HKD minPrice rows)
- `FAQPage` (must match visible FAQ text)
- `BreadcrumbList`

Sitewide header may keep Organization / LocalBusiness (already present).

### 3.4 Image alts
Primary hero: `香港{服務}｜JD Studio {場景}拍攝案例`

### 3.5 Internal links
Add 1 sentence near pricing:「詳細比較見《{blog title}》」→ matching blog URL.

---

## 4. Execution waves (Manus)

### Wave 0 — Verify interior (done if live matches)
Confirm `/services/interior-photography` still has definition + pricing table + Offer schema.

### Wave 1 — P0 service pages (do first)
1. Product — `pages/product-photography.md`  
2. Food — `pages/food-photography.md`  
3. Jewelry — `pages/jewelry-photography.md`  
4. Video / TVC — `pages/video-project.md`  

### Wave 2 — P1
5. Corporate event  
6. Party / event photography  
7. AI gallery  
8. Menu design  
9. Home (add H1 + hub definitions + links)

### Wave 3 — P2 + blogs
10. Art photography Offer schema  
11. Contact (LocalBusiness/ContactPage polish)  
12. Ensure each pricing blog has `Article`/`BlogPosting` + FAQ + speaks to service page  

**After each page:** Publish Squarespace → report checklist → move next.  
**Login:** If Squarespace login required, wait for Derek「Squarespace 已登入」then continue without re-asking.

---

## 5. Per-page acceptance checklist

For each published URL report:
- `url`
- `h1_text`
- `definition_present` (true/false) — exact phrase contains「是專門」or「是一項」
- `pricing_table_visible` (true/false)
- `schema_types_found` (list must include FAQPage, Service; Offer for priced services)
- `meta_description_snippet`
- `internal_blog_link` (true/false)

---

## 6. Source-of-truth files

```
content/geo-aeo/
  SITEWIDE-PLAYBOOK.md          ← this file
  interior-photography.*        ← gold template (already shipped pattern)
  pages/
    product-photography.md
    food-photography.md
    jewelry-photography.md
    video-project.md
    corporate-event.md
    event-photography.md
    home.md
    menu-design.md
    gallery-ai.md
  templates/
    service-schema.jsonld.html  ← copy/adapt Offer+FAQ skeleton
```

Prices must stay consistent with already-published blogs (do not invent new rate cards).
