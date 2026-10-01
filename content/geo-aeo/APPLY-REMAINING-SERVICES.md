# Apply remaining service-page AEO packs (Squarespace)

**Goal:** Match interior page pattern — visible definition + pricing + FAQ + `FAQPage`/`Service`/`Offer` JSON-LD.

## Pages (Wave 1)

| Page | File to paste |
|---|---|
| Product | `product-photography.squarespace-codeblock.html` |
| Food | `food-photography.squarespace-codeblock.html` |
| Corporate event | `corporate-event.squarespace-codeblock.html` |
| Party / event | `event-photography.squarespace-codeblock.html` |
| Jewelry | `jewelry-photography.squarespace-codeblock.html` |
| Art photography | `art-photography.squarespace-codeblock.html` + header `art-photography.schema.jsonld.html` |

Interior is already live — **do not replace** interior pack.

## Manus / editor steps (each page)

1. Open Squarespace editor for the URL
2. Add a **Code Block** near the top of the page body (below existing hero if needed), **or** Page → Settings → Advanced → Page Header Code Injection
3. Paste the full contents of the corresponding `*.squarespace-codeblock.html`
4. For Food: prefer placing near/inside existing `#jd-food-photography` context without deleting portfolio
5. For Corporate event: keep existing `#jd-event-full` blocks; add AEO block + schema (avoid duplicate conflicting H1 if page already has one — schema still required)
6. **Save → Publish**
7. Verify with Rich Results / view-source: must find `FAQPage`, `Service`, and `Offer` (or OfferCatalog)

## Acceptance per URL

- `definition_present` (「是專門」)
- `pricing_table_visible`
- `schema_types_found` includes FAQPage, Service, Offer
- WhatsApp CTA present
- Internal blog link present

## Do not

- Redesign whole pages
- Invent new prices beyond published blog bands
- Publish jdsys.biz for this
- Touch interior page
