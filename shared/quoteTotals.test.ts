import { describe, expect, it } from "vitest";
import {
  computeQuoteTotalsFromItems,
  quoteLineAmount,
  quoteMoneyDiffers,
} from "./quoteTotals";

describe("quoteLineAmount", () => {
  it("prefers stored amount so waived lines stay 0", () => {
    expect(
      quoteLineAmount({
        description: "B2 快速交相",
        quantity: 1,
        unitPrice: 800,
        amount: 0,
      })
    ).toBe(0);
    expect(
      quoteLineAmount({
        description: "Event Photoshoot",
        quantity: 4,
        unitPrice: 1000,
        amount: 4000,
      })
    ).toBe(4000);
  });
});

describe("computeQuoteTotalsFromItems", () => {
  it("does not inflate total with qty×price on waived rows", () => {
    const totals = computeQuoteTotalsFromItems(
      [
        {
          description: "Event Photoshoot (4 hours)",
          quantity: 4,
          unitPrice: 1000,
          amount: 4000,
        },
        {
          description: "B2 快速交相（12小時內）（Option）",
          quantity: 1,
          unitPrice: 800,
          amount: 0,
        },
        {
          description: "Transportation Fee",
          quantity: 1,
          unitPrice: 320,
          amount: 320,
        },
      ],
      0
    );
    expect(totals.subtotal).toBe(4320);
    expect(totals.total).toBe(4320);
  });

  it("applies % discount excluding transport", () => {
    const totals = computeQuoteTotalsFromItems(
      [
        {
          description: "Event Photoshoot",
          quantity: 1,
          unitPrice: 10000,
          amount: 10000,
        },
        {
          description: "Transportation Fee",
          quantity: 1,
          unitPrice: 320,
          amount: 320,
        },
      ],
      10
    );
    expect(totals.subtotal).toBe(10320);
    expect(totals.discountAmount).toBe(1000);
    expect(totals.total).toBe(9320);
  });
});

describe("quoteMoneyDiffers", () => {
  it("ignores sub-cent noise", () => {
    expect(quoteMoneyDiffers(1000, 1000.001)).toBe(false);
    expect(quoteMoneyDiffers(1000, 1001)).toBe(true);
  });
});
