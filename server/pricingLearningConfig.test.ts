import { describe, expect, it, vi, afterEach } from "vitest";
import {
  formatPricingLearningStartAtLabel,
  getPricingLearningStartAt,
  isQuoteEligibleForPricingLearning,
} from "../shared/pricingLearningConfig";

describe("pricingLearningConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults start at 2026-08-25 HKT", () => {
    expect(getPricingLearningStartAt().toISOString()).toBe(
      "2026-08-24T16:00:00.000Z"
    );
    expect(formatPricingLearningStartAtLabel()).toContain("2026");
  });

  it("respects PRICING_LEARNING_START_AT env", () => {
    vi.stubEnv("PRICING_LEARNING_START_AT", "2026-09-01T00:00:00+08:00");
    expect(getPricingLearningStartAt().toISOString()).toBe(
      "2026-08-31T16:00:00.000Z"
    );
  });

  it("filters quotes by createdAt", () => {
    expect(
      isQuoteEligibleForPricingLearning("2026-08-24T15:59:59.000Z")
    ).toBe(false);
    expect(
      isQuoteEligibleForPricingLearning("2026-08-24T16:00:00.000Z")
    ).toBe(true);
    expect(
      isQuoteEligibleForPricingLearning(new Date("2026-09-01T12:00:00+08:00"))
    ).toBe(true);
  });
});
