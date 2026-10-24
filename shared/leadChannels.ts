/**
 * Lead channel split: Google Ads vs Organic (SEO/GEO) vs AI (AEO) vs direct Website.
 *
 * quotes.leadSource values (varchar) — keep stable strings for PLATFORM_DEFS.
 * WA track `src` uses snake_case: google_ads | organic | ai | website | …
 */

export const LEAD_SOURCE_GOOGLE = "Google";
export const LEAD_SOURCE_ORGANIC = "Organic";
export const LEAD_SOURCE_AI = "AI";
/** Direct / unclassified site traffic (legacy “自然流量” bucket). */
export const LEAD_SOURCE_WEBSITE = "Website";

export type SearchLeadSource =
  | typeof LEAD_SOURCE_GOOGLE
  | typeof LEAD_SOURCE_ORGANIC
  | typeof LEAD_SOURCE_AI
  | typeof LEAD_SOURCE_WEBSITE;

export type WaTrackSource =
  | "fh_first_email"
  | "fh_follow_up"
  | "quote_email"
  | "review_invite"
  | "google_ads"
  | "organic"
  | "ai"
  | "website"
  | "other";

const PAID_MEDIA = new Set([
  "cpc",
  "ppc",
  "paid",
  "paidsearch",
  "paid_search",
  "display",
  "pam",
  "cpm",
  "cpv",
  "shopping",
]);

const AI_SOURCES = [
  "chatgpt",
  "openai",
  "perplexity",
  "gemini",
  "copilot",
  "bingchat",
  "claude",
  "anthropic",
  "you.com",
  "youcom",
  "phind",
  "poe",
  "deepseek",
  "grok",
  "meta.ai",
  "metaai",
];

const AI_HOST_SNIPPETS = [
  "chat.openai.com",
  "chatgpt.com",
  "perplexity.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "claude.ai",
  "you.com",
  "phind.com",
  "poe.com",
  "meta.ai",
  "grok.com",
];

const ORGANIC_SEARCH_SOURCES = new Set([
  "google",
  "google.com",
  "bing",
  "bing.com",
  "yahoo",
  "yahoo.com",
  "duckduckgo",
  "duckduckgo.com",
  "baidu",
  "yandex",
]);

const ORGANIC_SEARCH_HOST_SNIPPETS = [
  "google.",
  "bing.com",
  "yahoo.",
  "duckduckgo.com",
  "baidu.com",
  "yandex.",
  "search.brave.com",
];

export type AttributionLike = {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  adsCampaignId?: string | null;
  landingPageUrl?: string | null;
  /** document.referrer (or marketing-page referrer) captured on WA track */
  pageReferrer?: string | null;
  /** Explicit /api/track/wa?src= */
  src?: string | null;
};

function norm(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

function hostOf(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function includesAny(hay: string, needles: string[]): boolean {
  if (!hay) return false;
  return needles.some((n) => hay.includes(n));
}

/** True paid Ads click / campaign signal (not mere landing URL). */
export function hasPaidAdsSignal(a: AttributionLike | null | undefined): boolean {
  if (!a) return false;
  if (a.gclid || a.gbraid || a.wbraid) return true;
  if ((a.adsCampaignId ?? "").trim()) return true;
  const medium = norm(a.utmMedium);
  if (medium && PAID_MEDIA.has(medium)) return true;
  if (norm(a.src) === "google_ads") return true;
  return false;
}

function isAiSignal(a: AttributionLike): boolean {
  const src = norm(a.src);
  if (src === "ai") return true;
  const medium = norm(a.utmMedium);
  if (medium === "ai" || medium === "llm" || medium === "aeo" || medium === "geo_ai") {
    return true;
  }
  const source = norm(a.utmSource);
  if (source && AI_SOURCES.some((s) => source === s || source.includes(s))) {
    return true;
  }
  const hostBlob = `${hostOf(a.pageReferrer)} ${hostOf(a.landingPageUrl)}`;
  if (includesAny(hostBlob, AI_HOST_SNIPPETS)) return true;
  return false;
}

function isOrganicSearchSignal(a: AttributionLike): boolean {
  const src = norm(a.src);
  if (src === "organic") return true;
  const medium = norm(a.utmMedium);
  if (medium === "organic" || medium === "seo" || medium === "geo") return true;
  const source = norm(a.utmSource);
  if (
    source &&
    ORGANIC_SEARCH_SOURCES.has(source) &&
    (!medium || medium === "organic" || medium === "seo" || medium === "referral")
  ) {
    // google + organic / bare google without paid medium
    if (!PAID_MEDIA.has(medium)) return true;
  }
  const refHost = hostOf(a.pageReferrer);
  if (refHost && includesAny(refHost, ORGANIC_SEARCH_HOST_SNIPPETS)) {
    // Search referrer without paid click ids
    if (!hasPaidAdsSignal(a)) return true;
  }
  return false;
}

/**
 * Infer quote leadSource for search / site traffic.
 * Priority: paid Ads → AI / AEO → organic SEO/GEO → Website (direct).
 * Returns null when signals don't look like site/search channels.
 */
export function inferSearchLeadSource(
  a: AttributionLike | null | undefined
): SearchLeadSource | null {
  if (!a) return null;
  if (hasPaidAdsSignal(a)) return LEAD_SOURCE_GOOGLE;
  if (isAiSignal(a)) return LEAD_SOURCE_AI;
  if (isOrganicSearchSignal(a)) return LEAD_SOURCE_ORGANIC;
  const src = norm(a.src);
  if (src === "website" || a.landingPageUrl) return LEAD_SOURCE_WEBSITE;
  return null;
}

/** Map attribution → /api/track/wa src for site buttons. */
export function inferWaTrackSource(
  a: AttributionLike | null | undefined
): "google_ads" | "organic" | "ai" | "website" {
  const lead = inferSearchLeadSource(a ?? {});
  if (lead === LEAD_SOURCE_GOOGLE) return "google_ads";
  if (lead === LEAD_SOURCE_AI) return "ai";
  if (lead === LEAD_SOURCE_ORGANIC) return "organic";
  return "website";
}

export function leadSourceLabel(source: string | null | undefined): string {
  switch ((source ?? "").trim()) {
    case LEAD_SOURCE_GOOGLE:
      return "Google Ads";
    case LEAD_SOURCE_ORGANIC:
      return "SEO／GEO 自然搜尋";
    case LEAD_SOURCE_AI:
      return "AI／AEO（ChatGPT 等）";
    case LEAD_SOURCE_WEBSITE:
      return "網站直訪";
    default:
      return source?.trim() || "未知";
  }
}

/** Sources that count as “search demand” for AEO scoring (paid + organic + AI). */
export const SEARCH_DEMAND_LEAD_SOURCES = new Set<string>([
  LEAD_SOURCE_GOOGLE,
  LEAD_SOURCE_ORGANIC,
  LEAD_SOURCE_AI,
  LEAD_SOURCE_WEBSITE,
]);
