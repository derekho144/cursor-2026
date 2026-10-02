import type { AdsActionItem } from "./adsActionQueue";

export type SeoContentChange = {
  id: string;
  targetPath: string;
  targetUrl: string;
  query: string;
  purpose: "page1_and_aeo";
  changes: string[];
  instructions: Array<{
    id: "hero" | "definition" | "faq" | "schema" | "cta";
    label: string;
    location: string;
    suggestedCopy: string;
    requiredSignal: "definition" | "faq" | "service_schema" | "offer_schema" | "contact_cta";
  }>;
  requiredSignals: Array<"definition" | "faq" | "service_schema" | "offer_schema" | "contact_cta">;
  approvalRequired: true;
  autoPublish: false;
};

export type LandingPageVerification = {
  targetUrl: string;
  resolvedUrl: string | null;
  host: string | null;
  httpStatus: number | null;
  contentFingerprint: string | null;
  baselineFingerprint?: string;
  contentChanged: boolean;
  contentDiffSummary?: string;
  https: boolean;
  railwayDetected: boolean;
  hasDefinition: boolean;
  hasFaqPage: boolean;
  hasService: boolean;
  hasOffer: boolean;
  hasContactCta: boolean;
  readyForAds: boolean;
  reasons: string[];
};

export type RsaAssetPayload = {
  kind: "rsa_create";
  source: "seo_to_ads";
  adGroupId: string;
  finalUrl: string;
  path1: string;
  path2: string;
  headlines: Array<{ text: string; pinnedField?: "HEADLINE_1" | "HEADLINE_2" | "HEADLINE_3" }>;
  descriptions: string[];
};

export type FinalUrlPayload = {
  kind: "final_url_update";
  source: "seo_to_ads";
  adGroupId: string;
  finalUrl: string;
  targetPath: string;
  requiresLandingVerification: true;
};

export type SitelinkPayload = {
  kind: "sitelink_create";
  source: "seo_to_ads";
  campaignId: string;
  linkText: string;
  description1: string;
  description2: string;
  finalUrl: string;
};

export type NegativePayload = {
  kind: "campaign_negative";
  source: "seo_to_ads";
  campaignId: string;
  adGroupId: string;
  targetPath: string;
  finalUrl: string;
  matchType: "PHRASE";
  negativeTerms: string[];
  requiresLandingVerification: true;
};

export type KeywordPhrasePayload = {
  kind: "keyword_phrase_verify";
  source: "seo_to_ads";
  adGroupId: string;
  targetPath: string;
  keywords: string[];
  matchType: "PHRASE";
  requiresLandingVerification: true;
};

export type SeoToAdsPayload = RsaAssetPayload | FinalUrlPayload | SitelinkPayload | NegativePayload | KeywordPhrasePayload;

export type SeoToAdsPayloadBundle = {
  source: "seo_to_ads";
  campaignId: string;
  targetPath: string;
  finalUrl: string;
  adGroupId: string;
  payloads: SeoToAdsPayload[];
  forbiddenMutations: ["campaign_budget", "target_cpa", "campaign_status"];
  requiresLandingVerification: true;
};

export type SeoToAdsPlan = {
  planId: string;
  actionId: string;
  contentChange: SeoContentChange;
  baseline: LandingPageVerification;
  adsPayload: SeoToAdsPayloadBundle | null;
  adsReady: false;
  nextStep: "publish_content_then_verify";
};

export type SeoToAdsVerification = {
  planId: string;
  verification: LandingPageVerification;
  adsPayload: SeoToAdsPayloadBundle | null;
  adsReady: boolean;
  nextStep: "ads_dry_run" | "fix_landing_page";
};

export function contentChangeInstructionForReason(reason: string, instructions: SeoContentChange["instructions"]) {
  if (reason.includes("fingerprint") || reason.includes("no baseline")) return instructions.find((item) => item.id === "hero") ?? instructions[0];
  if (reason.includes("definition")) return instructions.find((item) => item.id === "definition");
  if (reason.includes("FAQPage")) return instructions.find((item) => item.id === "faq");
  if (reason.includes("Service") || reason.includes("Offer")) return instructions.find((item) => item.id === "schema");
  if (reason.includes("CTA")) return instructions.find((item) => item.id === "cta");
  return undefined;
}

const SERVICE_AD_MAP: Record<string, { adGroupId: string; finalUrl: string; path1: string; path2: string; serviceName: string }> = {
  "/services/product-photography": { adGroupId: "203224222492", finalUrl: "https://www.jdstudiohk.com/services/product-photography", path1: "services", path2: "product", serviceName: "產品攝影" },
  "/services/interior-photography": { adGroupId: "203224222452", finalUrl: "https://www.jdstudiohk.com/services/interior-photography", path1: "services", path2: "interior", serviceName: "室內攝影" },
  "/services/corporate-event": { adGroupId: "203224222532", finalUrl: "https://www.jdstudiohk.com/services/corporate-event", path1: "services", path2: "event", serviceName: "活動攝影" },
};

function rsaPayload(target: (typeof SERVICE_AD_MAP)[string]): RsaAssetPayload {
  const serviceHeadlines = target.serviceName === "室內攝影"
    ? ["香港室內空間攝影", "住宅及商業空間攝影", "地產放盤專業攝影", "酒店及辦公室攝影", "專業室內攝影師"]
    : [`JD Studio ${target.serviceName}`, "香港企業專業團隊", "透明收費快速交付", "立即查詢拍攝方案"];
  return {
    kind: "rsa_create", source: "seo_to_ads", adGroupId: target.adGroupId, finalUrl: target.finalUrl,
    path1: target.path1, path2: target.path2,
    headlines: [
      { text: `${target.serviceName} - 香港專業`, pinnedField: "HEADLINE_1" },
      { text: `${target.serviceName}報價`, pinnedField: "HEADLINE_2" },
      { text: "WhatsApp即日報價", pinnedField: "HEADLINE_3" },
      ...serviceHeadlines.map((text) => ({ text })),
    ],
    descriptions: [
      `JD Studio ${target.serviceName}，香港專業團隊，透明收費，WhatsApp即日報價。`,
      `專業器材及經驗團隊，按你的商業需要提供 ${target.serviceName} 方案。`,
    ],
  };
}

export function contentChangeForAction(item: Pick<AdsActionItem, "id" | "query" | "targetPath">): SeoContentChange {
  const targetUrl = `https://www.jdstudiohk.com${item.targetPath}`;
  const serviceName = item.targetPath.includes("interior") ? "室內及地產攝影" : item.targetPath.includes("product") ? "產品攝影" : item.targetPath.includes("event") ? "企業活動攝影" : "商業攝影";
  const instructions: SeoContentChange["instructions"] = [
    { id: "hero", label: "首屏／首段", location: "Squarespace 頁面 → 首屏 Hero 或第一個文字區塊", suggestedCopy: `香港${serviceName}服務｜JD Studio 是專門為品牌、企業及商戶提供${serviceName}，由前期溝通、拍攝到後期交付，按你的商業用途提供清晰方案。`, requiredSignal: "definition" },
    { id: "definition", label: "服務定義", location: "Squarespace 頁面 → 服務介紹 H2／首段下方", suggestedCopy: `JD Studio 是專門提供香港${serviceName}的專業團隊，適合需要網站、廣告、社交媒體及宣傳素材的品牌與企業。`, requiredSignal: "definition" },
    { id: "faq", label: "FAQ 內容", location: "Squarespace 頁面 → FAQ 區塊（可見內容）", suggestedCopy: `常見問題：${serviceName}服務包括前期溝通、現場拍攝及專業後期製作；實際報價會按拍攝場景、數量、用途及交付要求提供方案。`, requiredSignal: "faq" },
    { id: "schema", label: "JSON-LD", location: "Squarespace 頁面 → Code Block／Page Header Code Injection", suggestedCopy: "請確認 FAQPage、Service 及 Offer／OfferCatalog JSON-LD 已加入，並與頁面可見的服務名稱、範圍及報價描述一致。", requiredSignal: "service_schema" },
    { id: "cta", label: "聯絡 CTA", location: "Squarespace 頁面 → 首屏及 FAQ 下方 CTA", suggestedCopy: `WhatsApp 即日查詢${serviceName}方案及報價`, requiredSignal: "contact_cta" },
  ];
  return {
    id: `seo-content:${item.id}`, targetPath: item.targetPath, targetUrl, query: item.query, purpose: "page1_and_aeo",
    changes: [
      `在首屏及首段自然加入「${item.query}」服務語句，保持香港商業意圖。`,
      "補足清晰服務定義、適用客戶／場景及可引用的具體答案。",
      "補足可見 FAQ、服務範圍／報價 CTA，並保留原有 portfolio 內容。",
      "確認 FAQPage、Service 及 Offer／OfferCatalog JSON-LD 與可見內容一致。",
    ],
    instructions,
    requiredSignals: ["definition", "faq", "service_schema", "offer_schema", "contact_cta"], approvalRequired: true, autoPublish: false,
  };
}

export function adsPayloadBundleForAction(item: Pick<AdsActionItem, "actionType" | "targetPath">): SeoToAdsPayloadBundle | null {
  const target = SERVICE_AD_MAP[item.targetPath];
  if ((item.actionType !== "keyword_review" && item.actionType !== "quality_review") || !target) return null;
  const finalUrl: FinalUrlPayload = { kind: "final_url_update", source: "seo_to_ads", adGroupId: target.adGroupId, finalUrl: target.finalUrl, targetPath: item.targetPath, requiresLandingVerification: true };
  const sitelink: SitelinkPayload = { kind: "sitelink_create", source: "seo_to_ads", campaignId: "24002224927", linkText: target.serviceName, description1: `香港專業${target.serviceName}`, description2: "立即查詢拍攝方案", finalUrl: target.finalUrl };
  const negative: NegativePayload = { kind: "campaign_negative", source: "seo_to_ads", campaignId: "24002224927", adGroupId: target.adGroupId, targetPath: item.targetPath, finalUrl: target.finalUrl, matchType: "PHRASE", negativeTerms: ["免費", "教學", "課程", "招聘", "DIY"], requiresLandingVerification: true };
  const keyword: KeywordPhrasePayload = {
    kind: "keyword_phrase_verify", source: "seo_to_ads", adGroupId: target.adGroupId, targetPath: item.targetPath,
    keywords: target.serviceName === "室內攝影" ? ["室內攝影", "地產攝影", "室內攝影 香港", "地產攝影 香港"] : [target.serviceName],
    matchType: "PHRASE", requiresLandingVerification: true,
  };
  return { source: "seo_to_ads", campaignId: "24002224927", targetPath: item.targetPath, finalUrl: target.finalUrl, adGroupId: target.adGroupId, payloads: [rsaPayload(target), finalUrl, keyword, sitelink, negative], forbiddenMutations: ["campaign_budget", "target_cpa", "campaign_status"], requiresLandingVerification: true };
}

/** Backward-compatible single-payload view for callers that only need negatives. */
export function adsPayloadForAction(item: Pick<AdsActionItem, "actionType" | "targetPath">): NegativePayload | null {
  return adsPayloadBundleForAction(item)?.payloads.find((payload): payload is NegativePayload => payload.kind === "campaign_negative") ?? null;
}

export function isLandingReadyForAds(verification: LandingPageVerification): boolean {
  return verification.readyForAds && verification.contentChanged && !verification.railwayDetected;
}
