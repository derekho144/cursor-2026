import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch to avoid real API calls in unit tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Helper: mock OAuth token response
function mockTokenResponse() {
  return {
    ok: true,
    json: async () => ({ access_token: "mock-access-token" }),
  };
}

// Helper: mock Google Ads API search response
function mockAdsSearchResponse(results: any[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results }),
  };
}

// Helper: mock Google Ads API error response
function mockAdsErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({
      error: { code: status, message, status: "INVALID_ARGUMENT" },
    }),
  };
}

describe("Google Ads Service", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-dev-token";
    process.env.GOOGLE_ADS_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_ADS_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_ADS_REFRESH_TOKEN = "test-refresh-token";
    process.env.GOOGLE_ADS_CUSTOMER_ID = "9876630892";
    process.env.GOOGLE_ADS_AD_ACCOUNT_ID = "4839352747";
  });

  it("should fetch and group costs by date", async () => {
    // First call: OAuth token
    mockFetch
      .mockResolvedValueOnce(mockTokenResponse())
      // Second call: GAQL search
      .mockResolvedValueOnce(
        mockAdsSearchResponse([
          {
            campaign: { id: "123456789", name: "Test Campaign" },
            segments: { date: "2026-04-01" },
            metrics: { costMicros: "500000000" }, // 500 HKD
          },
          {
            campaign: { id: "987654321", name: "Another Campaign" },
            segments: { date: "2026-04-01" },
            metrics: { costMicros: "300000000" }, // 300 HKD
          },
          {
            campaign: { id: "123456789", name: "Test Campaign" },
            segments: { date: "2026-04-02" },
            metrics: { costMicros: "200000000" }, // 200 HKD
          },
        ])
      );

    const { fetchGoogleAdsCosts } = await import("./googleAds");
    const results = await fetchGoogleAdsCosts("2026-04-01", "2026-04-02");

    expect(results).toHaveLength(2);
    // Sorted by date descending
    expect(results[0].date).toBe("2026-04-02");
    expect(results[0].totalCostHKD).toBeCloseTo(200, 1);
    expect(results[1].date).toBe("2026-04-01");
    expect(results[1].totalCostHKD).toBeCloseTo(800, 1); // 500 + 300
    expect(results[1].campaigns).toHaveLength(2);
  });

  it("should calculate month total cost", async () => {
    // First call: OAuth token
    mockFetch
      .mockResolvedValueOnce(mockTokenResponse())
      // Second call: GAQL search for the whole month
      .mockResolvedValueOnce(
        mockAdsSearchResponse([
          {
            campaign: { id: "123456789", name: "Test Campaign" },
            segments: { date: "2026-04-01" },
            metrics: { costMicros: "500000000" }, // 500 HKD
          },
          {
            campaign: { id: "987654321", name: "Another Campaign" },
            segments: { date: "2026-04-01" },
            metrics: { costMicros: "300000000" }, // 300 HKD
          },
          {
            campaign: { id: "123456789", name: "Test Campaign" },
            segments: { date: "2026-04-02" },
            metrics: { costMicros: "200000000" }, // 200 HKD
          },
        ])
      );

    const { fetchGoogleAdsMonthCost } = await import("./googleAds");
    const total = await fetchGoogleAdsMonthCost(2026, 4);
    // 500 + 300 + 200 = 1000 HKD
    expect(total).toBeCloseTo(1000, 1);
  });

  it("should test connection successfully", async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockAdsSearchResponse([
          { customer: { id: "4839352747", descriptive_name: "JD STUDIO LTD" } },
        ])
      );

    const { testGoogleAdsConnection } = await import("./googleAds");
    const result = await testGoogleAdsConnection();
    expect(result.success).toBe(true);
    expect(result.customerId).toBe("4839352747");
  });

  it("should handle connection errors gracefully", async () => {
    mockFetch
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(mockAdsErrorResponse(403, "Authentication failed"));

    const { testGoogleAdsConnection } = await import("./googleAds");
    const result = await testGoogleAdsConnection();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Authentication failed");
  });

  it("should build quality dashboard from keyword rows", async () => {
    mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth2.googleapis.com")) {
        return mockTokenResponse();
      }
      if (u.includes("googleAds:search")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
        const query = String(body.query ?? "");
        if (query.includes("keyword_view")) {
          return mockAdsSearchResponse([
            {
              campaign: { id: "1", name: "Brand" },
              adGroup: { name: "Core" },
              adGroupCriterion: {
                keyword: { text: "studio photography", matchType: "PHRASE" },
                qualityInfo: {
                  qualityScore: 4,
                  searchPredictedCtr: "BELOW_AVERAGE",
                  creativeQualityScore: "AVERAGE",
                  postClickQualityScore: "BELOW_AVERAGE",
                },
              },
              metrics: { impressions: "100", clicks: "5", costMicros: "500000000", ctr: 0.05 },
            },
            {
              campaign: { id: "1", name: "Brand" },
              adGroup: { name: "Core" },
              adGroupCriterion: {
                keyword: { text: "wedding photo", matchType: "EXACT" },
                qualityInfo: {
                  qualityScore: 8,
                  searchPredictedCtr: "ABOVE_AVERAGE",
                  creativeQualityScore: "ABOVE_AVERAGE",
                  postClickQualityScore: "AVERAGE",
                },
              },
              metrics: { impressions: "200", clicks: "20", costMicros: "200000000", ctr: 0.1 },
            },
          ]);
        }
        if (query.includes("FROM campaign")) {
          return mockAdsSearchResponse([
            {
              campaign: { id: "1", name: "Brand" },
              metrics: {
                impressions: "300",
                clicks: "25",
                costMicros: "700000000",
                searchImpressionShare: 0.45,
                searchRankLostImpressionShare: 0.12,
              },
            },
          ]);
        }
        return mockAdsSearchResponse([]);
      }
      throw new Error(`Unexpected fetch: ${u}`);
    });

    const { fetchGoogleAdsQualityDashboard } = await import("./googleAds");
    const dash = await fetchGoogleAdsQualityDashboard(30);

    expect(dash.overview.keywordCount).toBe(2);
    expect(dash.overview.avgQualityScore).toBe(6);
    expect(dash.overview.lowQsKeywordCount).toBe(1);
    expect(dash.topKeywords[0].keyword).toBe("studio photography");
    expect(dash.topKeywords[0].qualityScore).toBe(4);
    expect(dash.campaigns[0].campaignName).toBe("Brand");
    // spend-weighted: (4*500 + 8*200) / 700 ≈ 5.1
    expect(dash.campaigns[0].avgQualityScore).toBeCloseTo(5.1, 1);
    expect(dash.distribution.some((d) => d.qualityScore === 4)).toBe(true);
  });

  it("should roll up campaign avg QS from keywords", async () => {
    const { attachCampaignAvgQualityScores } = await import("./googleAds");
    const campaigns = attachCampaignAvgQualityScores(
      [
        {
          campaignId: "1",
          campaignName: "A",
          avgQualityScore: null,
          impressions: 10,
          clicks: 1,
          costHKD: 100,
          searchImpressionShare: null,
          searchRankLostImpressionShare: null,
        },
      ],
      [
        {
          campaignId: "1",
          campaignName: "A",
          adGroupName: "g",
          keyword: "x",
          matchType: "EXACT",
          qualityScore: 3,
          expectedCtr: null,
          adRelevance: null,
          landingPageExperience: null,
          impressions: 10,
          clicks: 1,
          costHKD: 100,
          ctr: 10,
        },
        {
          campaignId: "1",
          campaignName: "A",
          adGroupName: "g",
          keyword: "y",
          matchType: "EXACT",
          qualityScore: 9,
          expectedCtr: null,
          adRelevance: null,
          landingPageExperience: null,
          impressions: 10,
          clicks: 1,
          costHKD: 100,
          ctr: 10,
        },
      ]
    );
    expect(campaigns[0].avgQualityScore).toBe(6);
  });
});
