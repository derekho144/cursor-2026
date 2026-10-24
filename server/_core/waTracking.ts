/**
 * Shared WhatsApp CTA tracking helpers.
 * All outbound WA links should go through /api/track/wa so clicks are attributed.
 *
 * Prefills (same intent, different wording) — staff can tell source from the first line:
 *   官網：「你好，我想查詢JD Studio的攝影服務」
 *   Email／系統追蹤：「您好，想了解一下你們的攝影服務」
 * Ads 短碼只存 DB／後台下拉，唔好寫入客人開場白（客人見到怪碼會刪／唔送）。
 * Do NOT put the words Email / Google / FH in the customer-visible text.
 */
import { ENV } from "./env";

const WA_DISPLAY = "wa.me/85291531976";
const WA_RAW = "https://wa.me/85291531976";
const WA_NUMBER = "85291531976";

/** Customer-visible openers — keep in sync with Squarespace site button. */
export const WA_PREFILL = {
  website: "你好，我想查詢JD Studio的攝影服務",
  email: "您好，想了解一下你們的攝影服務",
} as const;

export type WaPrefillKind = keyof typeof WA_PREFILL;

/** Alphabet without 0/O/1/I to keep staff typing easy. */
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Generate a short WA match code, e.g. W7K3M */
export function generateWaRefCode(): string {
  let s = "W";
  for (let i = 0; i < 4; i++) {
    s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)]!;
  }
  return s;
}

/** Pull Wxxxx from pasted first-line / staff input. */
export function extractWaRefCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw)
    .trim()
    .toUpperCase()
    .match(/\b(W[2-9A-HJ-NP-Z]{4})\b/);
  return m?.[1] ?? null;
}

export function appBaseUrl(): string {
  return (ENV.appBaseUrl || "https://jdsys.biz").replace(/\/$/, "");
}

export function waMeUrlWithPrefill(
  kind: WaPrefillKind,
  _opts?: { refCode?: string | null }
): string {
  // Never append staff/ref codes to customer-visible prefill.
  const text = WA_PREFILL[kind];
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;
}

/** Tracked redirect URL → logs click then redirects to WhatsApp. */
export function buildWaTrackUrl(
  src: string,
  opts?: {
    inq?: number | null;
    fhj?: number | null;
    q?: number | null;
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    adsCampaignId?: string | null;
    adsCampaignName?: string | null;
    landingPageUrl?: string | null;
  }
): string {
  const q = new URLSearchParams({ src });
  if (opts?.inq != null) q.set("inq", String(opts.inq));
  if (opts?.fhj != null) q.set("fhj", String(opts.fhj));
  if (opts?.q != null) q.set("q", String(opts.q));
  if (opts?.gclid) q.set("gclid", opts.gclid);
  if (opts?.gbraid) q.set("gbraid", opts.gbraid);
  if (opts?.wbraid) q.set("wbraid", opts.wbraid);
  if (opts?.utmSource) q.set("utm_source", opts.utmSource);
  if (opts?.utmMedium) q.set("utm_medium", opts.utmMedium);
  if (opts?.utmCampaign) q.set("utm_campaign", opts.utmCampaign);
  if (opts?.utmContent) q.set("utm_content", opts.utmContent);
  if (opts?.utmTerm) q.set("utm_term", opts.utmTerm);
  if (opts?.adsCampaignId) q.set("campaign_id", opts.adsCampaignId);
  if (opts?.adsCampaignName) q.set("campaign", opts.adsCampaignName);
  if (opts?.landingPageUrl) q.set("lp", opts.landingPageUrl);
  return `${appBaseUrl()}/api/track/wa?${q.toString()}`;
}

/** HTML anchor that looks like wa.me but clicks go through tracking. */
export function waTrackAnchor(
  src: string,
  opts?: {
    inq?: number | null;
    fhj?: number | null;
    q?: number | null;
    style?: string;
    gclid?: string | null;
    adsCampaignId?: string | null;
    landingPageUrl?: string | null;
  }
): string {
  const href = buildWaTrackUrl(src, opts);
  const style = opts?.style ?? "color:#25D366;font-weight:bold";
  return `<a href="${href}" style="${style}">${WA_DISPLAY}</a>`;
}

/**
 * Rewrite raw wa.me / old track URLs in text or HTML to a specific track URL.
 * Safe for both plain text and HTML bodies.
 */
export function rewriteWaLinks(content: string, trackUrl: string): string {
  return content
    .replace(/https?:\/\/[^\s"'<>]*\/api\/track\/wa\?[^\s"'<>]*/gi, trackUrl)
    .replace(/https:\/\/wa\.me\/85291531976/g, trackUrl)
    .replace(/([^"'=\/]|^)wa\.me\/85291531976/g, `$1${trackUrl}`);
}

export { WA_DISPLAY, WA_RAW };
