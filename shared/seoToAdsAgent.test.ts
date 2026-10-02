import { describe, expect, it } from "vitest";
import { adsPayloadBundleForAction, adsPayloadForAction, contentChangeForAction, contentChangeInstructionForReason, isLandingReadyForAds, type LandingPageVerification } from "./seoToAdsAgent";

describe("SEO-to-Ads Agent contract", () => {
  const item = { id: "trusted-negative:203224222492", query: "產品攝影 香港", targetPath: "/services/product-photography", actionType: "keyword_review" as const };

  it("creates an approval-only content change contract", () => {
    const contract = contentChangeForAction(item);
    expect(contract.approvalRequired).toBe(true);
    expect(contract.autoPublish).toBe(false);
    expect(contract.requiredSignals).toEqual(["definition", "faq", "service_schema", "offer_schema", "contact_cta"]);
    expect(contract.changes).toEqual([
      "在首屏及首段自然加入「產品攝影 香港」服務語句，保持香港商業意圖。",
      "補足清晰服務定義、適用客戶／場景及可引用的具體答案。",
      "補足可見 FAQ、服務範圍／報價 CTA，並保留原有 portfolio 內容。",
      "確認 FAQPage、Service 及 Offer／OfferCatalog JSON-LD 與可見內容一致。",
    ]);
    expect(contract.instructions).toHaveLength(5);
    expect(contract.instructions.find((instruction) => instruction.id === "hero")?.suggestedCopy).toContain("產品攝影");
    expect(contentChangeInstructionForReason("missing FAQPage JSON-LD", contract.instructions)?.id).toBe("faq");
    expect(contentChangeInstructionForReason("content fingerprint did not change after proposal", contract.instructions)?.id).toBe("hero");
  });

  it("maps only trusted keyword actions to an Ads payload", () => {
    expect(adsPayloadForAction(item)).toMatchObject({ kind: "campaign_negative", campaignId: "24002224927", adGroupId: "203224222492", requiresLandingVerification: true });
    expect(adsPayloadForAction({ ...item, actionType: "landing_page_review" })).toBeNull();
  });

  it("maps RSA, final URL and sitelink without budget or tCPA mutations", () => {
    const bundle = adsPayloadBundleForAction(item);
    expect(bundle?.payloads.map((payload) => payload.kind)).toEqual(["rsa_create", "final_url_update", "keyword_phrase_verify", "sitelink_create", "campaign_negative"]);
    expect(bundle?.payloads.find((payload) => payload.kind === "rsa_create")).toMatchObject({ adGroupId: "203224222492", finalUrl: "https://www.jdstudiohk.com/services/product-photography" });
    expect(bundle?.payloads.find((payload) => payload.kind === "sitelink_create")).toMatchObject({ campaignId: "24002224927", linkText: "產品攝影" });
    expect(bundle?.forbiddenMutations).toEqual(["campaign_budget", "target_cpa", "campaign_status"]);
  });

  it("maps the interior quality review to an explicit safe Ads payload", () => {
    const interior = adsPayloadBundleForAction({ actionType: "quality_review", targetPath: "/services/interior-photography" });
    expect(interior).toMatchObject({ campaignId: "24002224927", adGroupId: "203224222452", finalUrl: "https://www.jdstudiohk.com/services/interior-photography" });
    expect(interior?.payloads.map((payload) => payload.kind)).toEqual(["rsa_create", "final_url_update", "keyword_phrase_verify", "sitelink_create", "campaign_negative"]);
    expect(interior?.payloads.find((payload) => payload.kind === "keyword_phrase_verify")).toMatchObject({ adGroupId: "203224222452", matchType: "PHRASE", keywords: ["室內攝影", "地產攝影", "室內攝影 香港", "地產攝影 香港"] });
    expect(interior?.payloads.find((payload) => payload.kind === "rsa_create")).toMatchObject({ finalUrl: "https://www.jdstudiohk.com/services/interior-photography" });
  });

  it("requires changed, valid, non-Railway landing content before Ads", () => {
    const verification: LandingPageVerification = {
      targetUrl: item.targetPath, resolvedUrl: "https://www.jdstudiohk.com/services/product-photography", host: "www.jdstudiohk.com", httpStatus: 200,
      contentFingerprint: "new", contentChanged: true, https: true, railwayDetected: false, hasDefinition: true, hasFaqPage: true,
      hasService: true, hasOffer: true, hasContactCta: true, readyForAds: true, reasons: [],
    };
    expect(isLandingReadyForAds(verification)).toBe(true);
    expect(isLandingReadyForAds({ ...verification, contentChanged: false })).toBe(false);
    expect(isLandingReadyForAds({ ...verification, railwayDetected: true })).toBe(false);
  });
});
