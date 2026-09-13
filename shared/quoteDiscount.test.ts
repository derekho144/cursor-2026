import { describe, expect, it } from "vitest";
import {
  computeQuoteDiscountAmount,
  discountableQuoteSubtotal,
  isDiscountExcludedQuoteLine,
} from "./quoteDiscount";

describe("quoteDiscount", () => {
  const items = [
    {
      description: "Event photoshoot 2 hrs",
      amount: 2000,
      category: "photographer_crew",
    },
    {
      description: "Retouching",
      amount: 1500,
      category: "other",
    },
    {
      description: "Transportation Fee",
      amount: 320,
      category: "transport",
    },
  ];

  it("excludes transport from discountable subtotal", () => {
    expect(discountableQuoteSubtotal(items)).toBe(3500);
  });

  it("applies % only to non-transport lines (5% of 3500 = 175)", () => {
    expect(computeQuoteDiscountAmount(items, 5)).toBe(175);
    expect(computeQuoteDiscountAmount(items, 5)).not.toBe(191);
  });

  it("excludes expedited fees", () => {
    expect(
      isDiscountExcludedQuoteLine({
        description: "加急費用 Rush fee",
        amount: 500,
      })
    ).toBe(true);
    expect(
      computeQuoteDiscountAmount(
        [
          { description: "Photoshoot", amount: 1000 },
          { description: "Expedited delivery", amount: 500 },
        ],
        10
      )
    ).toBe(100);
  });

  it("detects transport by description when category missing", () => {
    expect(
      computeQuoteDiscountAmount(
        [
          { description: "Photography", amount: 1000 },
          { description: "車費 Transportation", amount: 320 },
        ],
        5
      )
    ).toBe(50);
  });
});
