# GSC URL hygiene — jdstudiohk.com (Squarespace)

**Date:** 2026-10-23  
**Property:** `https://www.jdstudiohk.com/`  
**Trigger:** Search Console email (2026-10-22) — “Page with redirect” + “Alternate page with proper canonical tag”.

## What the email means (not a site-wide index collapse)

| GSC reason | Meaning here | Severity |
|---|---|---|
| **Page with redirect** | Apex/`http` → `https://www…` and old aliases (`/services/products` → product, `/services/video` → video-project). Google indexes the **destination**, not the redirect URL. | Normal / intentional |
| **Alternate page with proper canonical** | e.g. `/home` returns 200 but `rel=canonical` → `/`. Google correctly keeps homepage. Trailing-slash URLs also self-point to non-slash canonical. | Mostly OK; `/home` should 301 |

Main service pages (product, food, interior, jewelry, corporate-event, event, art, contact-us) inspected **Submitted and indexed** with self-canonical (2026-10-23 sample).

## Bugs to fix (P0)

### Soft-404 + homepage canonical
These return **HTTP 404** but HTML title/canonical look like the homepage:

- `/zh`, `/en`, `/services`, `/contact`
- `/services/artwork-photography` (dead nav link; real page is `/services/art-photography`)

### Homepage duplicate
- `/home` — **200**, canonical `/`, listed in sitemap → GSC “Alternate page with proper canonical tag”

## Squarespace URL Mappings (apply in Settings → URL Mappings / Redirects)

Paste as permanent redirects (301):

```
/home -> /
/home/ -> /
/contact -> /contact-us
/services/artwork-photography -> /services/art-photography
/services/artwork-photography/ -> /services/art-photography
/zh -> /
/en -> /
/services -> /
```

Notes:
- `/services/products` and `/services/video` already 301 to real service pages — keep.
- `/services/corporate-event-photography` already redirects to `/services/corporate-event` — keep; update homepage nav text link to the final slug when editing.
- Do **not** put `/zh` `/en` `/services` `/contact` `/home` in sitemap.

## Homepage nav (Squarespace editor)

In the “服務範圍 Services” text block, change:

| Broken / alias | Use instead |
|---|---|
| `/services/artwork-photography` | `/services/art-photography` |
| `/services/corporate-event-photography` | `/services/corporate-event` (optional; redirect already works) |

## Schema / codeblock follow-up

`interior-photography` BreadcrumbList previously pointed `item` at `https://www.jdstudiohk.com/services` (404). Repo fix: breadcrumb is Home → 室內攝影 only (no `/services` hub). Re-paste updated schema/codeblock after merge if live injection still has `/services`.

## Verify after apply

```bash
curl -sSI https://www.jdstudiohk.com/home | rg -i 'HTTP/|location'
# expect 301 → /
curl -sSI https://www.jdstudiohk.com/contact | rg -i 'HTTP/|location'
# expect 301 → /contact-us
curl -sS -o /dev/null -w '%{http_code}\n' https://www.jdstudiohk.com/zh
# after mapping: 301; if unmapped, 404 — must NOT ship homepage canonical on 404 body
```

Then GSC → URL Inspection on `/`, `/home`, `/contact-us`, and top service pages → Request indexing only for changed aliases if needed. Re-submit sitemap once.
