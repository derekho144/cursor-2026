import { describe, expect, it } from "vitest";
import {
  formatHourlyQuantityAdjustments,
  reconcileHourlyQuoteItems,
} from "./quoteItemHours";

describe("reconcileHourlyQuoteItems", () => {
  it("aligns quantity to hours in Event Photography (8 hours)", () => {
    const { items, adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "Event Photography (8 hours)",
        quantity: 1,
        unitPrice: 1000,
        amount: 1000,
      },
      {
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
        amount: 320,
      },
    ]);

    expect(adjustments).toHaveLength(1);
    expect(items[0].quantity).toBe(8);
    expect(items[0].amount).toBe(8000);
    expect(items[1].quantity).toBe(1);
  });

  it("skips product shot-count quotes", () => {
    const { adjustments } = reconcileHourlyQuoteItems("product", [
      {
        description: "Product Photography (8 hours)",
        quantity: 1,
        unitPrice: 130,
      },
    ]);
    expect(adjustments).toHaveLength(0);
  });

  it("leaves quantity unchanged when already matches", () => {
    const { adjustments } = reconcileHourlyQuoteItems("corporate_event", [
      {
        description: "Event Photography",
        quantity: 8,
        unitPrice: 1000,
      },
    ]);
    expect(adjustments).toHaveLength(0);
  });
});

describe("formatHourlyQuantityAdjustments", () => {
  it("formats adjustment summary", () => {
    const msg = formatHourlyQuantityAdjustments([
      {
        description: "Event Photography (8 hours)",
        previousQuantity: 1,
        nextQuantity: 8,
        hoursFromText: 8,
      },
    ]);
    expect(msg).toContain("1→8");
    expect(msg).toContain("8 小時");
  });
});
