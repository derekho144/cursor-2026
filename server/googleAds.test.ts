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
});
