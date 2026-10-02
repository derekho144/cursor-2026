import { describe, expect, it } from "vitest";
import { buildAdsActionQueue } from "@shared/adsActionQueue";
import { isTrustedNegativePlan } from "@shared/adsActionExecution";

describe("trusted Ads negative action plan", () => {
  it("maps product, interior and event paths to fixed ad groups", () => {
    const paths = [
      ["/services/product-photography", "203224222492"],
      ["/services/interior-photography", "203224222452"],
      ["/services/corporate-event", "203224222532"],
    ] as const;
    for (const [targetPath, adGroupId] of paths) {
      const [item] = buildAdsActionQueue([{
        id: `x:${targetPath}`, query: "商業攝影", serviceLabel: "服務", targetPath,
        score: 50, organicPosition: 8,
        ads: { commercialSignal: "available", keywordCount: 2, spendHKD: 20, clicks: 2, avgCpcHKD: 10, weightedQualityScore: 8, lowQualitySpendHKD: 0 },
        revenue: { acceptedCount: 0, acceptedRevenueHKD: 0 },
      }]);
      expect(item.executionPlan?.campaignId).toBe("24002224927");
      expect(item.executionPlan?.adGroupId).toBe(adGroupId);
      expect(item.executionPlan?.matchType).toBe("PHRASE");
      expect(isTrustedNegativePlan(item.executionPlan)).toBe(true);
    }
  });

  it("never trusts a plan with an unapproved term or campaign", () => {
    expect(isTrustedNegativePlan({ kind: "campaign_negative", campaignId: "999", adGroupId: "203224222492", matchType: "PHRASE", negativeTerms: ["核心服務詞"], mutationCount: 1, preview: "" })).toBe(false);
  });
});
