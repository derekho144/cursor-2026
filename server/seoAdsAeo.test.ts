import { describe, expect, it } from "vitest";
import {
  backlogScore,
  canonicalQueryIntent,
  classifyAeoReadiness,
  expectedTime,
  gscPositionTrend,
  isCommercialHongKongQuery,
  scoreServicePriority,
} from "./seoAdsAeo";

describe("SEO + Ads + AEO priority model", () => {
  it("shows ranking up when the current position number is lower", () => {
    expect(gscPositionTrend(12.4, 18.1)).toEqual({ change: 5.7, trend: "up" });
  });

  it("shows ranking down when the current position number is higher", () => {
    expect(gscPositionTrend(18.1, 12.4)).toEqual({ change: -5.7, trend: "down" });
  });

  it("does not guess without a previous GSC baseline", () => {
    expect(gscPositionTrend(12, null).trend).toBe("insufficient");
  });

  it("classifies a complete service page as AEO ready", () => {
    expect(
      classifyAeoReadiness({
        httpStatus: 200,
        hasFaqPage: true,
        hasService: true,
        hasOffer: true,
        hasDefinition: true,
        hasContactCta: true,
      })
    ).toBe("ready");
  });

  it("marks partial structured data as a gap instead of ready", () => {
    expect(
      classifyAeoReadiness({
        httpStatus: 200,
        hasFaqPage: true,
        hasService: false,
        hasOffer: false,
        hasDefinition: false,
        hasContactCta: true,
      })
    ).toBe("partial");
  });

  it("gives a transparent higher priority to revenue, SEO and paid-search gaps", () => {
    const priority = scoreServicePriority({
      id: "product",
      label: "產品攝影",
      path: "/services/product-photography",
      acceptedRevenueHKD: 20000,
      acceptedCount: 4,
      maxAcceptedRevenueHKD: 20000,
      ads: {
        keywordCount: 3,
        spendHKD: 120,
        weightedQualityScore: 4,
        lowQualitySpendHKD: 100,
      },
      organic: { clicks: 3, impressions: 220, ctr: 1.36, position: 14.2 },
      aeo: {
        status: "partial",
        httpStatus: 200,
        hasFaqPage: true,
        hasService: true,
        hasOffer: false,
        hasDefinition: true,
        hasContactCta: true,
      },
    });

    expect(priority.breakdown.businessValue).toBe(40);
    expect(priority.breakdown.paidSearchFriction).toBeGreaterThan(15);
    expect(priority.breakdown.organicOpportunity).toBe(22);
    expect(priority.breakdown.aeoGap).toBe(6);
    expect(priority.score).toBeGreaterThan(80);
    expect(priority.recommendations.join(" ")).toContain("第一頁");
  });

  it("does not invent paid-search urgency when a service has no ads signal", () => {
    const priority = scoreServicePriority({
      id: "jewelry",
      label: "珠寶攝影",
      path: "/services/jewelry-photography",
      acceptedRevenueHKD: 0,
      acceptedCount: 0,
      maxAcceptedRevenueHKD: 20000,
      ads: { keywordCount: 0, spendHKD: 0, weightedQualityScore: null, lowQualitySpendHKD: 0 },
      organic: { clicks: 0, impressions: 0, ctr: 0, position: null },
      aeo: {
        status: "ready",
        httpStatus: 200,
        hasFaqPage: true,
        hasService: true,
        hasOffer: true,
        hasDefinition: true,
        hasContactCta: true,
      },
    });

    expect(priority.breakdown.paidSearchFriction).toBe(0);
    expect(priority.confidence).toBe("limited");
  });

  it("keeps Hong Kong commercial photography queries and rejects non-commercial research queries", () => {
    expect(isCommercialHongKongQuery("香港產品攝影報價")).toBe(true);
    expect(isCommercialHongKongQuery("corporate event photography hong kong")).toBe(true);
    expect(isCommercialHongKongQuery("如何拍攝食物")).toBe(false);
    expect(isCommercialHongKongQuery("香港餐廳推薦")).toBe(false);
  });

  it("groups space and generic-service variants into one query intent", () => {
    expect(canonicalQueryIntent("產品 攝影")).toBe(canonicalQueryIntent("產品攝影服務"));
    expect(canonicalQueryIntent("產品 攝影")).toBe("產品攝影");
  });

  it("labels page-two, attainable queries as a fast backlog action", () => {
    expect(expectedTime(14.2, 24).label).toContain("2–6 週");
    expect(expectedTime(48, 58).label).toContain("3–6+");

    const score = backlogScore({
      revenue: 12000,
      maxRevenue: 12000,
      ads: {
        keywordCount: 2,
        spendHKD: 100,
        clicks: 20,
        avgCpcHKD: 5,
        weightedQualityScore: 5,
        lowQualitySpendHKD: 50,
      },
      organic: { clicks: 2, impressions: 150, ctr: 1.33, position: 14 },
      aeo: {
        status: "partial",
        httpStatus: 200,
        hasFaqPage: true,
        hasService: true,
        hasOffer: false,
        hasDefinition: true,
        hasContactCta: true,
      },
      difficulty: 24,
    });

    expect(score.total).toBeGreaterThan(70);
    expect(score.ahrefsFeasibility).toBe(13);
  });
});
