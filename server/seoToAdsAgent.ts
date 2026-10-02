import { createHash } from "node:crypto";
import type { AdsActionItem } from "@shared/adsActionQueue";
import { adsPayloadBundleForAction, contentChangeForAction, isLandingReadyForAds, type LandingPageVerification, type SeoToAdsPlan, type SeoToAdsVerification } from "@shared/seoToAdsAgent";

const ALLOWED_HOSTS = new Set(["www.jdstudiohk.com", "jdstudiohk.com"]);

function fingerprint(html: string): string {
  return createHash("sha256").update(html.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

export async function verifyLandingPage(targetUrl: string, baselineFingerprint?: string): Promise<LandingPageVerification> {
  const parsed = new URL(targetUrl);
  const base = {
    targetUrl, resolvedUrl: null as string | null, host: parsed.hostname, httpStatus: null as number | null,
    contentFingerprint: null as string | null, baselineFingerprint, contentChanged: false, contentDiffSummary: undefined as string | undefined, https: parsed.protocol === "https:",
    railwayDetected: /railway\.app/i.test(parsed.hostname), hasDefinition: false, hasFaqPage: false,
    hasService: false, hasOffer: false, hasContactCta: false, readyForAds: false, reasons: [] as string[],
  };
  if (!base.https) base.reasons.push("landing page must use HTTPS");
  if (!ALLOWED_HOSTS.has(parsed.hostname)) base.reasons.push("landing page host is not an approved JD Studio host");
  if (base.railwayDetected) base.reasons.push("railway.app is prohibited");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(targetUrl, { redirect: "follow", headers: { "User-Agent": "JD-Studio-SEO-to-Ads-Agent/1.0" }, signal: controller.signal });
    clearTimeout(timeout);
    const html = await response.text();
    const lower = html.toLowerCase();
    base.resolvedUrl = response.url;
    base.host = new URL(response.url).hostname;
    base.httpStatus = response.status;
    base.contentFingerprint = fingerprint(html);
    base.baselineFingerprint = baselineFingerprint;
    base.contentChanged = Boolean(baselineFingerprint && base.contentFingerprint !== baselineFingerprint);
    base.contentDiffSummary = baselineFingerprint
      ? (base.contentChanged ? `內容 fingerprint 已更新：${baselineFingerprint} → ${base.contentFingerprint}` : `內容 fingerprint 未變：${baselineFingerprint}`)
      : `已建立 live baseline：${base.contentFingerprint}`;
    base.railwayDetected = base.railwayDetected || /railway\.app/i.test(response.url) || /railway\.app/i.test(html);
    base.hasFaqPage = /"@type"\s*:\s*"faqpage"|faqpage/i.test(html);
    base.hasService = /"@type"\s*:\s*"service"|schema\.org\/service/i.test(html);
    base.hasOffer = /"@type"\s*:\s*"offer(?:catalog)?"|offer(?:catalog)?/i.test(html);
    base.hasDefinition = lower.includes("是專門") || lower.includes("專門提供") || lower.includes("specializes in");
    base.hasContactCta = lower.includes("whatsapp") || lower.includes("立即報價") || lower.includes("立即查詢");
    if (response.status < 200 || response.status >= 400) base.reasons.push(`landing page HTTP ${response.status}`);
    if (!ALLOWED_HOSTS.has(base.host)) base.reasons.push("final resolved host is not an approved JD Studio host");
    if (!base.hasDefinition) base.reasons.push("missing visible service definition");
    if (!base.hasFaqPage) base.reasons.push("missing FAQPage JSON-LD");
    if (!base.hasService) base.reasons.push("missing Service JSON-LD");
    if (!base.hasOffer) base.reasons.push("missing Offer/OfferCatalog JSON-LD");
    if (!base.hasContactCta) base.reasons.push("missing WhatsApp or quote CTA");
    if (!base.contentChanged) base.reasons.push(baselineFingerprint ? "content fingerprint did not change after proposal" : "no baseline fingerprint supplied");
  } catch (error) {
    base.reasons.push(error instanceof Error ? `fetch failed: ${error.message}` : "fetch failed");
  }
  base.readyForAds = base.httpStatus != null && base.httpStatus >= 200 && base.httpStatus < 400 && base.https &&
    ALLOWED_HOSTS.has(base.host ?? "") && !base.railwayDetected && base.hasDefinition && base.hasFaqPage && base.hasService && base.hasOffer && base.hasContactCta;
  return base;
}

export async function buildSeoToAdsPlan(item: AdsActionItem): Promise<SeoToAdsPlan> {
  const contentChange = contentChangeForAction(item);
  const baseline = await verifyLandingPage(contentChange.targetUrl);
  return {
    planId: `seo-to-ads:${item.id}`,
    actionId: item.id,
    contentChange,
    baseline,
    adsPayload: adsPayloadBundleForAction(item),
    adsReady: false,
    nextStep: "publish_content_then_verify",
  };
}

export async function verifySeoToAdsPlan(item: AdsActionItem, baselineFingerprint: string): Promise<SeoToAdsVerification> {
  const contentChange = contentChangeForAction(item);
  const verification = await verifyLandingPage(contentChange.targetUrl, baselineFingerprint);
  const adsPayload = adsPayloadBundleForAction(item);
  return {
    planId: `seo-to-ads:${item.id}`,
    verification,
    adsPayload,
    adsReady: Boolean(adsPayload && isLandingReadyForAds(verification)),
    nextStep: adsPayload && isLandingReadyForAds(verification) ? "ads_dry_run" : "fix_landing_page",
  };
}
