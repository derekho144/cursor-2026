import { describe, expect, it } from "vitest";
import {
  applySoftFactorToAmount,
  leadBudgetTier,
  PLATFORM_SUGGEST_MIN_SAMPLES,
  resolvePlatformSuggestRows,
  softFactorForTier,
} from "./pricingLeadSourcePolicy";

describe("pricingLeadSourcePolicy", () => {
  it("maps HelloToby / PRO360 to low and Google to mid_high", () => {
    expect(leadBudgetTier("HelloToby")).toBe("low");
    expect(leadBudgetTier("PRO360")).toBe("low");
    expect(leadBudgetTier("Google")).toBe("mid_high");
    expect(leadBudgetTier("Organic")).toBe("neutral");
    expect(leadBudgetTier(null)).toBe("neutral");
  });

  it("prefers exact platform rows when sample ≥ min", () => {
    const matched = [
      ...Array.from({ length: 6 }, (_, i) => ({
        leadSource: "Google",
        total: 8000 + i,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        leadSource: "HelloToby",
        total: 3000 + i,
      })),
    ];
    const pick = resolvePlatformSuggestRows({
      matchedAccepted: matched,
      leadSource: "Google",
    });
    expect(pick.scope).toBe("exact");
    expect(pick.rows).toHaveLength(6);
    expect(pick.softFactor).toBe(1);
    expect(pick.note).toContain("Google");
  });

  it("falls back to low-budget tier when exact sample thin", () => {
    const matched = [
      { leadSource: "HelloToby", total: 2800 },
      { leadSource: "HelloToby", total: 3000 },
      { leadSource: "PRO360", total: 3200 },
      { leadSource: "PRO360", total: 3400 },
      { leadSource: "PRO360", total: 3600 },
      { leadSource: "Google", total: 9000 },
      { leadSource: "Google", total: 9500 },
    ];
    // Only 2 HelloToby — below min — should use HelloToby+PRO360 tier (5)
    const pick = resolvePlatformSuggestRows({
      matchedAccepted: matched,
      leadSource: "HelloToby",
      minSamples: PLATFORM_SUGGEST_MIN_SAMPLES,
    });
    expect(pick.scope).toBe("tier");
    expect(pick.tier).toBe("low");
    expect(pick.rows).toHaveLength(5);
    expect(pick.softFactor).toBe(1);
  });

  it("soft-adjusts global mid for low / mid_high when samples thin", () => {
    const matched = [
      { leadSource: "Organic", total: 5000 },
      { leadSource: "Organic", total: 5500 },
      { leadSource: "Google", total: 9000 },
      { leadSource: "HelloToby", total: 3000 },
    ];
    const low = resolvePlatformSuggestRows({
      matchedAccepted: matched,
      leadSource: "PRO360",
    });
    expect(low.scope).toBe("global_adjusted");
    expect(low.softFactor).toBe(softFactorForTier("low"));
    expect(low.softFactor).toBeLessThan(1);

    const hi = resolvePlatformSuggestRows({
      matchedAccepted: matched,
      leadSource: "Google",
    });
    expect(hi.scope).toBe("global_adjusted");
    expect(hi.softFactor).toBeGreaterThan(1);
  });

  it("applies soft factor to amounts", () => {
    expect(applySoftFactorToAmount(10000, 0.9)).toBe(9000);
    expect(applySoftFactorToAmount(10000, 1.08)).toBe(10800);
    expect(applySoftFactorToAmount(10000, 1)).toBe(10000);
    expect(applySoftFactorToAmount(null, 0.9)).toBeNull();
  });
});
