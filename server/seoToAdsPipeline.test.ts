import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buildSeoToAdsPlan = vi.fn();
const verifySeoToAdsPlan = vi.fn();
const executeSeoToAdsBundle = vi.fn();

vi.mock("./seoToAdsAgent", () => ({ buildSeoToAdsPlan, verifySeoToAdsPlan }));
vi.mock("./seoAdsMutationExecutor", () => ({ executeSeoToAdsBundle }));

afterEach(() => vi.clearAllMocks());

describe("SEO-to-Ads one-click pipeline", () => {
  const item = {
    id: "keyword-review:product", backlogId: "product", actionType: "keyword_review" as const,
    query: "產品攝影 香港", targetPath: "/services/product-photography", title: "product",
    rationale: "rationale", expectedImpact: "impact", risk: "high" as const,
    proposedScope: "scope", status: "pending" as const,
  };

  beforeEach(() => {
    buildSeoToAdsPlan.mockResolvedValue({
      planId: "seo-to-ads:keyword-review:product", actionId: item.id,
      contentChange: { targetPath: item.targetPath },
      baseline: { contentFingerprint: "baseline-1234567", httpStatus: 200, reasons: [] },
      adsPayload: { payloads: [{ kind: "rsa_create" }] }, adsReady: false,
      nextStep: "publish_content_then_verify",
    });
    verifySeoToAdsPlan.mockResolvedValue({ adsReady: true, verification: { reasons: [] }, adsPayload: { payloads: [{ kind: "rsa_create" }] }, nextStep: "ads_dry_run" });
    executeSeoToAdsBundle.mockResolvedValue({ actionId: item.id, state: "executed", message: "verified", partialFailure: false, mutationCount: 1 });
  });

  it("creates the baseline and stops without any Ads mutation on the first click", async () => {
    const { runSeoToAdsPipeline } = await import("./seoToAdsPipeline");
    const result = await runSeoToAdsPipeline(item);
    expect(result.state).toBe("blocked");
    expect(result.pipelineStage).toBe("content_contract");
    expect(result.baselineFingerprint).toBe("baseline-1234567");
    expect(verifySeoToAdsPlan).not.toHaveBeenCalled();
    expect(executeSeoToAdsBundle).not.toHaveBeenCalled();
  });

  it("runs verification and the executor after a saved baseline", async () => {
    const { runSeoToAdsPipeline } = await import("./seoToAdsPipeline");
    const result = await runSeoToAdsPipeline(item, { baselineFingerprint: "baseline-1234567" });
    expect(result.state).toBe("executed");
    expect(result.pipelineStage).toBe("gaql_verification");
    expect(verifySeoToAdsPlan).toHaveBeenCalledWith(item, "baseline-1234567");
    expect(executeSeoToAdsBundle).toHaveBeenCalledWith(item, { baselineFingerprint: "baseline-1234567" });
  });
});
