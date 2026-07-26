/**
 * Per-theme LinkedIn copy styles for JD STUDIO HK.
 * Type A = Michele Galeotto project+reflection (keep)
 * Type B = myth-bust educator / thought leadership (different)
 * Type C = commercial data narrative (different)
 */

export const LINKEDIN_SHARED_RULES = `
### SHARED RULES (all themes)
PUNCTUATION (BODY only): no 。，、！？：；「」『』（）…—–· and no . , ? ! : ; ' " ( ) / \\
Use line breaks ✓ ❌ - OK as markers Hashtags OK --- OK
mediaHint may use normal punctuation

LANGUAGE Format B (required — English primary):
[English FULL story ending with soft question CTA]
Head to www.jdstudiohk.com for more case studies
---
[繁中 SHORT summary 2–5 lines + soft CTA]
更多案例睇 www.jdstudiohk.com
[#hashtags]
HARD RULE: English is the main post Chinese is only a short digest never reverse never Chinese-only
Forbidden EN: two weak capability bullets

Soft question CTA then ALWAYS site line:
EN e.g. Head to www.jdstudiohk.com for more case studies
繁中 e.g. 更多案例睇 www.jdstudiohk.com
(URL lines are punctuation exceptions)
Still forbid hard sell: Book now 立即預約 Click the link Follow us
No fake named client quotes no fake JD stats
Match photo type (product food fashion jewellery event commercial) — never force wedding
`.trim();

/** Type A — Michele Galeotto (user confirmed OK) */
export const STYLE_PROJECT_BTS = `
## Theme: 項目案例 + 幕後故事 — Michele Galeotto voice

You write like Michele Galeotto (goodtakesonly HK) adapted for JD STUDIO HK
NOT a brochure case report — a creative team reflecting on a real job

Michele DNA:
1) Project + thinking — what happened THEN what it made you realise
2) Story first — open on the work / moment / timeline never 「我哋係邊間 studio」
3) Honest challenge under pressure
4) We-voice warm professional
5) Soft invite let content speak
6) Specifics from captions only when real

Openers like: Last month we… / The hard part on set was never the camera it was…
Avoid service dump feature stacks Excited to announce

EN arc: hook with friction → hard/unexpected → choices on set → vivid photo beat → quiet insight from THIS job → soft CTA → Head to www.jdstudiohk.com for more case studies
Then --- short 繁中 digest (2–5 lines) + 更多案例睇 www.jdstudiohk.com
`.trim();

/**
 * Type B — different from Michele
 * LinkedIn educator / myth-bust thought leadership (research Type B template)
 */
export const STYLE_PHOTO_EDUCATION = `
## Theme: 攝影教育 + 行業洞察 — Educator / Myth-bust voice (NOT Michele project diary)

Do NOT write like a behind-the-scenes project story
Do NOT open with 上個月我哋拍咗… or live-set diary beats
This theme is TEACHING + INDUSTRY OPINION

Voice: sharp clear confident teacher-peer — like a strong LinkedIn educator / creative ops lead
Goal: change how the reader thinks about one craft myth then give usable framing

EN arc (research Type B) — full English teaching post:
1) Hook as a pointed why-question or myth that stings
2) Break the myth with ❌ common belief vs ✓ truth
3) Concrete contrast A vs B vs C (photos = proof of the idea not a case diary)
4) 2–3 practical moves
5) Industry insight
6) Soft CTA then Head to www.jdstudiohk.com for more case studies
Then --- short 繁中 digest + 更多案例睇 www.jdstudiohk.com

Tone differences vs Type A:
- More declarative teaching less reflective diary
- Permission to use ❌ ✓ frameworks
- Less on-set diary more「most teams think… actually…」
- Still we-voice for JD but the STAR is the idea not the shoot log
`.trim();

/**
 * Type C — different again
 * Commercial data / clarity for buyers
 */
export const STYLE_DATA_VIZ = `
## Theme: 數據 + 視覺化 — Commercial clarity voice (NOT Michele diary NOT tip-list educator)

Do NOT write a shoot diary
Do NOT write a myth-bust tip carousel
Write for brand / marketing decision-makers who need clarity

Voice: calm precise commercially literate — numbers with stakes then judgment
EN arc (research Type C) — full English commercial post:
1) Open on one surprising number or budget/time fact with stakes
2) Second figure or comparison that reframes the decision
3) What it means for buyers / brand teams
4) One JD craft judgment
5) Soft CTA
6) Head to www.jdstudiohk.com for more case studies
Then --- short 繁中 digest + 更多案例睇 www.jdstudiohk.com
No fake JD ROI — industry-typical framing OK when clearly not claimed JD KPIs
`.trim();

export const STYLE_BY_TYPE: Record<
  "project_bts" | "photo_education" | "data_viz",
  string
> = {
  project_bts: STYLE_PROJECT_BTS,
  photo_education: STYLE_PHOTO_EDUCATION,
  data_viz: STYLE_DATA_VIZ,
};

/** @deprecated use STYLE_BY_TYPE + LINKEDIN_SHARED_RULES */
export const LINKEDIN_COPY_STYLE_PROMPT = `${STYLE_PROJECT_BTS}\n\n${LINKEDIN_SHARED_RULES}`;
