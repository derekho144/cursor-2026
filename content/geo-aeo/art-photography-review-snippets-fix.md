# Fix GSC Review snippets (6 invalid items)

## Cause
All invalid items are on **one URL**:
https://www.jdstudiohk.com/services/art-photography

Three testimonial cards each emit broken Review microdata. GSC reports **6 invalid items** across these issue types (3 cards × overlapping errors):

1. `Invalid object type for field '<parent_node>'` — `Review` nested under `ProfessionalService` / Service page (self-serving reviews are **not eligible** for Review snippets)
2. `Missing field 'itemReviewed'`
3. `Missing field 'ratingValue' (in 'reviewRating')` — invalid bare `<meta itemprop="reviewRating" content="5">`

A page-header JS scrubber (`jd-art-review-microdata-cleanup`) was added earlier, but **Googlebot parses raw HTML before JS**, so GSC still fails.

## Correct fix
1. Replace Squarespace Code Block `#jd-art-photography` with  
   `art-photography.squarespace-codeblock.no-review-schema.html`  
   (keeps visible testimonials; removes all Review / rating microdata and the ProfessionalService itemscope wrapper).
2. Delete header/code script id `jd-art-review-microdata-cleanup`.
3. Do **not** re-add Review or AggregateRating JSON-LD for this service page.
4. GSC → Enhancements → Review snippets → **Validate fix** after publish.

## After publish
Validation usually moves Started → Passed after Google re-crawls (often several days).
