import { beforeEach, describe, expect, it, vi } from "vitest";

const mutateGoogleAdsService = vi.fn();
const mutateGoogleAds = vi.fn();
const runGoogleAdsGaql = vi.fn();
const verifyLandingPage = vi.fn();

vi.mock("./googleAds", () => ({ mutateGoogleAds, mutateGoogleAdsService, runGoogleAdsGaql }));
vi.mock("./seoToAdsAgent", async () => {
  const actual = await vi.importActual<typeof import("./seoToAdsAgent")>("./seoToAdsAgent");
  return { ...actual, verifyLandingPage };
});

describe("SEO-to-Ads live mutation executor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    verifyLandingPage.mockResolvedValue({
      targetUrl: "https://www.jdstudiohk.com/services/product-photography",
      resolvedUrl: "https://www.jdstudiohk.com/services/product-photography",
      host: "www.jdstudiohk.com",
      httpStatus: 200,
      contentFingerprint: "new-fingerprint",
      contentChanged: true,
      https: true,
      railwayDetected: false,
      hasDefinition: true,
      hasFaqPage: true,
      hasService: true,
      hasOffer: true,
      hasContactCta: true,
      readyForAds: true,
      reasons: [],
    });
    runGoogleAdsGaql.mockImplementation(async (query: string) => {
      if (query.includes("ad_group_criterion.keyword.text")) {
        return ["產品攝影"].map((text) => ({ adGroupCriterion: { keyword: { text, matchType: "PHRASE" }, status: "ENABLED" } }));
      }
      return [];
    });
    mutateGoogleAdsService.mockResolvedValue({ partialFailure: false, results: [{ resourceName: "customers/4839352747/assets/1" }] });
    mutateGoogleAds.mockResolvedValue({ partialFailure: false, results: [] });
  });

  it("runs RSA, final URL and sitelink validateOnly without live calls", async () => {
    const { executeSeoToAdsBundle } = await import("./seoAdsMutationExecutor");
    const result = await executeSeoToAdsBundle({
      id: "keyword-review:product", backlogId: "product", actionType: "keyword_review", query: "產品攝影 香港",
      targetPath: "/services/product-photography", title: "product", rationale: "rationale", expectedImpact: "impact",
      risk: "high", proposedScope: "scope", status: "approved",
    }, { dryRunOnly: true, baselineFingerprint: "old-fingerprint" });

    expect(result.state).toBe("dry_run_passed");
    expect(result.operations).toEqual(["rsa_create", "final_url_update", "keyword_phrase_verify", "sitelink_create", "campaign_negative"]);
    expect(mutateGoogleAdsService).toHaveBeenCalledTimes(2);
    expect(mutateGoogleAds).toHaveBeenCalledWith(expect.any(Array), true);
    expect(mutateGoogleAdsService).toHaveBeenCalledWith("adGroupAds", expect.any(Array), true);
    expect(mutateGoogleAdsService).toHaveBeenCalledWith("assets", expect.any(Array), true);
    expect(JSON.stringify(mutateGoogleAdsService.mock.calls)).not.toMatch(/campaignBudget|targetCpa|campaignStatus/);
  });

  it("blocks mutation when landing baseline is missing", async () => {
    const { executeSeoToAdsBundle } = await import("./seoAdsMutationExecutor");
    const result = await executeSeoToAdsBundle({
      id: "keyword-review:product", backlogId: "product", actionType: "keyword_review", query: "產品攝影 香港",
      targetPath: "/services/product-photography", title: "product", rationale: "rationale", expectedImpact: "impact",
      risk: "high", proposedScope: "scope", status: "approved",
    });

    expect(result.state).toBe("blocked");
    expect(mutateGoogleAdsService).not.toHaveBeenCalled();
  });
});
