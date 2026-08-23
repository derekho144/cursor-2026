/**
 * Shared WhatsApp CTA tracking helpers.
 * All outbound WA links should go through /api/track/wa so clicks are attributed.
 *
 * Prefills (same intent, different wording) — staff can tell source from the first line:
 *   官網：「你好，我想查詢JD Studio的攝影服務」
 *   Email／系統追蹤：「您好，想了解一下你們的攝影服務」
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

export function appBaseUrl(): string {
  return (ENV.appBaseUrl || "https://jdsys.biz").replace(/\/$/, "");
}

export function waMeUrlWithPrefill(kind: WaPrefillKind): string {
  const text = encodeURIComponent(WA_PREFILL[kind]);
  return `https://wa.me/${WA_NUMBER}?text=${text}`;
}

/** Tracked redirect URL → logs click then redirects to WhatsApp. */
export function buildWaTrackUrl(
  src: string,
  opts?: { inq?: number | null; fhj?: number | null }
): string {
  const q = new URLSearchParams({ src });
  if (opts?.inq != null) q.set("inq", String(opts.inq));
  if (opts?.fhj != null) q.set("fhj", String(opts.fhj));
  return `${appBaseUrl()}/api/track/wa?${q.toString()}`;
}

/** HTML anchor that looks like wa.me but clicks go through tracking. */
export function waTrackAnchor(
  src: string,
  opts?: { inq?: number | null; fhj?: number | null; style?: string }
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
