import { describe, expect, it } from "vitest";
import { buildAdsActionQueue, buildInteriorQualityReviewAction, filterAdsActionHistory, getExecutableAdsActions, isRequeueableInteriorAction, toAdsActionHistoryRecord } from "./adsActionQueue";

describe("Ads Action Queue", () => {
  it("does not create actions without Ads evidence", () => {
    expect(buildAdsActionQueue([{
      id: "product:test",
      query: "產品攝影",
      serviceLabel: "產品攝影",
      targetPath: "/services/product-photography",
      score: 80,
      organicPosition: 14,
      ads: { commercialSignal: "unavailable", keywordCount: 0, spendHKD: 0, clicks: 0, avgCpcHKD: null, weightedQualityScore: null, lowQualitySpendHKD: 0, conversions: 0 },
      searchTerms: { termCount: 0, conversions: 0, spendHKD: 0, clicks: 0, topTerms: [] },
      revenue: { acceptedCount: 1, acceptedRevenueHKD: 3000, leadCount: 2, searchLeads: 1, winRate: 50 },
    }])).toEqual([]);
  });

  it("creates landing review from search-term conversions even without keyword_view rows", () => {
    const [item] = buildAdsActionQueue([{
      id: "product:search-term",
      query: "香港產品攝影報價",
      serviceLabel: "產品攝影",
      targetPath: "/services/product-photography",
      score: 78,
      organicPosition: 16,
      ads: { commercialSignal: "available", keywordCount: 0, spendHKD: 0, clicks: 0, avgCpcHKD: null, weightedQualityScore: null, lowQualitySpendHKD: 0, conversions: 0 },
      searchTerms: { termCount: 2, conversions: 2, spendHKD: 80, clicks: 10, topTerms: ["香港產品攝影報價"] },
      revenue: { acceptedCount: 0, acceptedRevenueHKD: 0, leadCount: 3, searchLeads: 2, winRate: 0 },
    }]);
    expect(item.actionType).toBe("landing_page_review");
    expect(item.rationale).toContain("轉換");
    expect(item.rationale).toContain("Google／網站");
  });

  it("prioritises low-quality review and keeps it non-mutating", () => {
    const [item] = buildAdsActionQueue([{
      id: "product:test",
      query: "產品攝影報價",
      serviceLabel: "產品攝影",
      targetPath: "/services/product-photography",
      score: 80,
      organicPosition: 14,
      ads: { commercialSignal: "available", keywordCount: 3, spendHKD: 120, clicks: 20, avgCpcHKD: 6, weightedQualityScore: 5, lowQualitySpendHKD: 80 },
      revenue: { acceptedCount: 2, acceptedRevenueHKD: 6000 },
    }]);

    expect(item.actionType).toBe("quality_review");
    expect(item.risk).toBe("medium");
    expect(item.proposedScope).toContain("不改 budget");
    expect(item.status).toBe("pending");
  });

  it("marks competitive keyword review high risk", () => {
    const [item] = buildAdsActionQueue([{
      id: "event:test",
      query: "企業活動攝影",
      serviceLabel: "企業活動攝影",
      targetPath: "/services/corporate-event",
      score: 70,
      organicPosition: 8,
      ads: { commercialSignal: "available", keywordCount: 2, spendHKD: 50, clicks: 5, avgCpcHKD: 10, weightedQualityScore: 8, lowQualitySpendHKD: 0 },
      revenue: { acceptedCount: 0, acceptedRevenueHKD: 0 },
    }]);

    expect(item.actionType).toBe("keyword_review");
    expect(item.risk).toBe("high");
    expect(item.expectedImpact).toContain("避免只因 CPC 低就加價");
  });

  it("removes completed actions from the executable set and prevents a second trigger", () => {
    const actions = [
      { id: "a", status: "approved" as const },
      { id: "b", status: "approved" as const },
    ];
    const completed = new Set<string>();
    expect(getExecutableAdsActions(actions, completed).map((item) => item.id)).toEqual(["a", "b"]);
    completed.add("a");
    expect(getExecutableAdsActions(actions, completed).map((item) => item.id)).toEqual(["b"]);
    expect(getExecutableAdsActions(actions, completed).map((item) => item.id)).toEqual(["b"]);
  });

  it("creates a bounded audit record without raw payloads", () => {
    const record = toAdsActionHistoryRecord({
      actionId: "a",
      title: "產品攝影",
      state: "executed",
      message: "completed",
      mutationCount: 2,
      operations: ["campaignCriterion.create"],
      verification: "GAQL verified",
    });
    expect(record).toMatchObject({ actionId: "a", state: "executed", mutationCount: 2 });
    expect(JSON.stringify(record)).not.toContain("refresh_token");
    expect(JSON.stringify(record)).not.toContain("client_secret");
  });

  it("stores requeue reason and operator without exposing credentials", () => {
    const record = toAdsActionHistoryRecord({
      actionId: "interior-photography:quality-review",
      title: "室內攝影",
      state: "blocked",
      message: "blocked",
      mutationCount: 0,
      requeueReason: "修正 Landing 後重驗",
      requeuedBy: "operator@example.com",
      requeuedAt: "2026-10-02T04:00:00.000Z",
    });
    expect(record).toMatchObject({ requeueReason: "修正 Landing 後重驗", requeuedBy: "operator@example.com" });
    expect(JSON.stringify(record)).not.toContain("token");
  });

  it("filters history by completed, blocked, or failed state", () => {
    const records = [
      { actionId: "a", title: "A", state: "executed" as const, completedAt: "2026-10-02T00:00:00Z", message: "ok", mutationCount: 1 },
      { actionId: "b", title: "B", state: "blocked" as const, completedAt: "2026-10-02T00:00:00Z", message: "blocked", mutationCount: 0 },
      { actionId: "c", title: "C", state: "failed" as const, completedAt: "2026-10-02T00:00:00Z", message: "failed", mutationCount: 0 },
    ];
    expect(filterAdsActionHistory(records, "all")).toHaveLength(3);
    expect(filterAdsActionHistory(records, "executed").map((record) => record.actionId)).toEqual(["a"]);
    expect(filterAdsActionHistory(records, "blocked").map((record) => record.actionId)).toEqual(["b"]);
    expect(filterAdsActionHistory(records, "failed").map((record) => record.actionId)).toEqual(["c"]);
  });

  it("requeues only blocked or failed interior actions with a pending status", () => {
    const blocked = { actionId: "interior-photography:quality-review", title: "室內攝影相關性", state: "blocked" as const };
    const executed = { ...blocked, state: "executed" as const };
    expect(isRequeueableInteriorAction(blocked)).toBe(true);
    expect(isRequeueableInteriorAction(executed)).toBe(false);
    expect(buildInteriorQualityReviewAction().status).toBe("pending");
    expect(buildInteriorQualityReviewAction().targetPath).toBe("/services/interior-photography");
  });
});
