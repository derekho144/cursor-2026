/**
 * Google Ads / landing-page attribution helpers.
 * Capture GCLID + UTM + campaign on WA clicks and quotes so Search #3/#4
 * can be judged by qualified quotes, not WhatsApp click spam.
 *
 * Squarespace / site WA button should NOT use raw wa.me. Prefer:
 *   https://jdsys.biz/api/track/wa?src=google_ads&gclid={gclid}&campaign_id={campaignid}&lp={lpurl}
 * Auto-tagging (ValueTrack) can fill gclid / campaignid / lpurl on final URL.
 * Optional UTM: utm_source, utm_medium, utm_campaign, utm_content, utm_term
 * Optional: gbraid, wbraid, campaign (name)
 */

import { z } from "zod";

export type AdsAttribution = {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  adsCampaignId: string | null;
  adsCampaignName: string | null;
  landingPageUrl: string | null;
};

const EMPTY: AdsAttribution = {
  gclid: null,
  gbraid: null,
  wbraid: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  adsCampaignId: null,
  adsCampaignName: null,
  landingPageUrl: null,
};

function clip(raw: unknown, max: number): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Parse attribution from Express/query-string style records. */
export function parseAdsAttribution(
  q: Record<string, unknown> | URLSearchParams | null | undefined
): AdsAttribution {
  if (!q) return { ...EMPTY };
  const get = (key: string): unknown => {
    if (q instanceof URLSearchParams) return q.get(key);
    return q[key];
  };
  return {
    gclid: clip(get("gclid"), 255),
    gbraid: clip(get("gbraid"), 255),
    wbraid: clip(get("wbraid"), 255),
    utmSource: clip(get("utm_source") ?? get("utmSource"), 128),
    utmMedium: clip(get("utm_medium") ?? get("utmMedium"), 128),
    utmCampaign: clip(get("utm_campaign") ?? get("utmCampaign"), 255),
    utmContent: clip(get("utm_content") ?? get("utmContent"), 255),
    utmTerm: clip(get("utm_term") ?? get("utmTerm"), 255),
    adsCampaignId: clip(
      get("campaign_id") ?? get("campaignId") ?? get("adsCampaignId"),
      64
    ),
    adsCampaignName: clip(
      get("campaign") ?? get("campaign_name") ?? get("adsCampaignName"),
      255
    ),
    landingPageUrl: clip(get("lp") ?? get("landing") ?? get("landingPageUrl"), 2048),
  };
}

export function hasAdsAttribution(a: AdsAttribution | null | undefined): boolean {
  if (!a) return false;
  return Boolean(
    a.gclid ||
      a.gbraid ||
      a.wbraid ||
      a.utmCampaign ||
      a.adsCampaignId ||
      a.landingPageUrl
  );
}

/**
 * When `lp` is missing on /api/track/wa, use the browser Referer as the landing
 * page (marketing site → track redirect). Skip WA / track / blank referers.
 */
export function landingPageFromReferer(referer: string | null | undefined): string | null {
  const raw = (referer || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (
      host === "wa.me" ||
      host.endsWith(".whatsapp.com") ||
      host === "api.whatsapp.com" ||
      host === "web.whatsapp.com"
    ) {
      return null;
    }
    // Ignore self-hits on the track endpoint
    if (u.pathname.includes("/api/track/wa")) return null;
    return u.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

/** Append attribution query params onto a track URL. */
export function appendAttributionParams(
  url: string,
  attr: Partial<AdsAttribution> | null | undefined
): string {
  if (!attr || !hasAdsAttribution(attr as AdsAttribution)) return url;
  const u = new URL(url);
  const map: Array<[string, string | null | undefined]> = [
    ["gclid", attr.gclid],
    ["gbraid", attr.gbraid],
    ["wbraid", attr.wbraid],
    ["utm_source", attr.utmSource],
    ["utm_medium", attr.utmMedium],
    ["utm_campaign", attr.utmCampaign],
    ["utm_content", attr.utmContent],
    ["utm_term", attr.utmTerm],
    ["campaign_id", attr.adsCampaignId],
    ["campaign", attr.adsCampaignName],
    ["lp", attr.landingPageUrl],
  ];
  for (const [k, v] of map) {
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

const optStr = (max: number) => z.string().max(max).nullable().optional();

/** Zod fields for quote create/update (and similar write APIs). */
export const adsAttributionInputSchema = z.object({
  gclid: optStr(255),
  gbraid: optStr(255),
  wbraid: optStr(255),
  utmSource: optStr(128),
  utmMedium: optStr(128),
  utmCampaign: optStr(255),
  utmContent: optStr(255),
  utmTerm: optStr(255),
  adsCampaignId: optStr(64),
  adsCampaignName: optStr(255),
  landingPageUrl: optStr(2048),
  whatsappClickId: z.number().int().positive().nullable().optional(),
});

export type AdsAttributionInput = z.infer<typeof adsAttributionInputSchema>;

/** Normalize empty strings → null for DB insert/update. */
export function normalizeAttributionForDb(
  input: Partial<AdsAttributionInput> | null | undefined
): AdsAttribution & { whatsappClickId: number | null } {
  const a = parseAdsAttribution({
    gclid: input?.gclid,
    gbraid: input?.gbraid,
    wbraid: input?.wbraid,
    utmSource: input?.utmSource,
    utmMedium: input?.utmMedium,
    utmCampaign: input?.utmCampaign,
    utmContent: input?.utmContent,
    utmTerm: input?.utmTerm,
    adsCampaignId: input?.adsCampaignId,
    adsCampaignName: input?.adsCampaignName,
    landingPageUrl: input?.landingPageUrl,
  });
  const clickId =
    input?.whatsappClickId != null &&
    Number.isFinite(input.whatsappClickId) &&
    input.whatsappClickId > 0
      ? Math.floor(input.whatsappClickId)
      : null;
  return { ...a, whatsappClickId: clickId };
}
