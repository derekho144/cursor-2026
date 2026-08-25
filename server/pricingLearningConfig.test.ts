import { describe, expect, it, vi, afterEach } from "vitest";
import {
  evaluateSuggestConfidence,
  formatPricingLearningStartAtLabel,
  getPricingLearningStartAt,
  isQuoteEligibleForPricingLearning,
  SUGGEST_TRUST,
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

describe("evaluateSuggestConfidence", () => {
  it("hides suggestion below MIN_SHOW", () => {
    const r = evaluateSuggestConfidence({ acceptedCount: 7, structuredCount: 7 });
    expect(r.confidence).toBe("none");
    expect(r.showSuggestion).toBe(false);
    expect(r.progress.needForShow).toBe(SUGGEST_TRUST.MIN_SHOW_ACCEPTED);
  });

  it("marks 8–14 as advisory", () => {
    const r = evaluateSuggestConfidence({
      acceptedCount: 10,
      structuredCount: 10,
    });
    expect(r.confidence).toBe("advisory");
    expect(r.showSuggestion).toBe(true);
  });

  it("marks 15+ with enough structured as usable", () => {
    const r = evaluateSuggestConfidence({
      acceptedCount: 15,
      structuredCount: 8,
    });
    expect(r.confidence).toBe("usable");
  });

  it("keeps 15+ with low structured as advisory", () => {
    const r = evaluateSuggestConfidence({
      acceptedCount: 15,
      structuredCount: 4,
    });
    expect(r.confidence).toBe("advisory");
  });

  it("marks 25+ with high structured as trusted", () => {
    const r = evaluateSuggestConfidence({
      acceptedCount: 25,
      structuredCount: 18,
    });
    expect(r.confidence).toBe("trusted");
  });
});
