/**
 * loyalty.calcTier.test.ts
 * Unit tests for the calcTier pure function and LOYALTY_TIERS constants
 */
import { describe, it, expect } from "vitest";
import { calcTier, LOYALTY_TIERS } from "./db";

describe("LOYALTY_TIERS", () => {
  it("should have 4 tiers defined", () => {
    expect(Object.keys(LOYALTY_TIERS)).toHaveLength(4);
    expect(LOYALTY_TIERS).toHaveProperty("silver");
    expect(LOYALTY_TIERS).toHaveProperty("golden");
    expect(LOYALTY_TIERS).toHaveProperty("diamond");
    expect(LOYALTY_TIERS).toHaveProperty("black_diamond");
  });

  it("should have ascending minSpend thresholds", () => {
    expect(LOYALTY_TIERS.silver.minSpend).toBeLessThan(LOYALTY_TIERS.golden.minSpend);
    expect(LOYALTY_TIERS.golden.minSpend).toBeLessThan(LOYALTY_TIERS.diamond.minSpend);
    expect(LOYALTY_TIERS.diamond.minSpend).toBeLessThan(LOYALTY_TIERS.black_diamond.minSpend);
  });

  it("should have non-negative discounts", () => {
    for (const tier of Object.values(LOYALTY_TIERS)) {
      expect(tier.discount).toBeGreaterThanOrEqual(0);
      expect(tier.anniversaryDiscount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("calcTier", () => {
  it("should return silver for zero spend", () => {
    expect(calcTier(0)).toBe("silver");
  });

  it("should return silver for spend below golden threshold", () => {
    expect(calcTier(LOYALTY_TIERS.golden.minSpend - 1)).toBe("silver");
  });

  it("should return golden at the golden threshold", () => {
    expect(calcTier(LOYALTY_TIERS.golden.minSpend)).toBe("golden");
  });

  it("should return golden for spend between golden and diamond thresholds", () => {
    const midpoint = Math.floor(
      (LOYALTY_TIERS.golden.minSpend + LOYALTY_TIERS.diamond.minSpend) / 2
    );
    expect(calcTier(midpoint)).toBe("golden");
  });

  it("should return diamond at the diamond threshold", () => {
    expect(calcTier(LOYALTY_TIERS.diamond.minSpend)).toBe("diamond");
  });

  it("should return diamond for spend between diamond and black_diamond thresholds", () => {
    const midpoint = Math.floor(
      (LOYALTY_TIERS.diamond.minSpend + LOYALTY_TIERS.black_diamond.minSpend) / 2
    );
    expect(calcTier(midpoint)).toBe("diamond");
  });

  it("should return black_diamond at the black_diamond threshold", () => {
    expect(calcTier(LOYALTY_TIERS.black_diamond.minSpend)).toBe("black_diamond");
  });

  it("should return black_diamond for very large spend", () => {
    expect(calcTier(999999999)).toBe("black_diamond");
  });
});
