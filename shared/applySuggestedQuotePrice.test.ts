import { describe, expect, it } from "vitest";
import { applySuggestedLearningPriceToItems } from "./applySuggestedQuotePrice";
import { splitQuoteLineItemMoney } from "./quoteLineItemKind";

describe("applySuggestedLearningPriceToItems", () => {
  it("scales photographer_crew lines to target and leaves transport alone", () => {
    const items = [
      {
        id: "1",
        description: "Event Photoshoot",
        quantity: 1,
        unitPrice: 4000,
        amount: 4000,
        category: "photographer_crew" as const,
      },
      {
        id: "2",
        description: "extra hour",
        quantity: 2,
        unitPrice: 1000,
        amount: 2000,
        category: "photographer_crew" as const,
      },
      {
        id: "3",
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
        amount: 320,
        category: "transport" as const,
      },
    ];

    const result = applySuggestedLearningPriceToItems(items, 9000);
    expect(result.ok).toBe(true);
    expect(result.scaledCount).toBe(2);
    expect(result.previousLearningTotal).toBe(6000);
    expect(result.nextLearningTotal).toBe(9000);
    expect(result.items[2]!.amount).toBe(320);
    expect(result.items[2]!.unitPrice).toBe(320);
    const split = splitQuoteLineItemMoney(result.items);
    expect(split.photographerCrewSubtotal).toBe(9000);
    expect(split.transportSubtotal).toBe(320);
  });

  it("does not change waived strikethrough lines", () => {
    const items = [
      {
        id: "1",
        description: "Product Photoshoot",
        quantity: 1,
        unitPrice: 5000,
        amount: 5000,
        category: "photographer_crew" as const,
      },
      {
        id: "2",
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
        amount: 0, // waived
        category: "transport" as const,
      },
    ];
    const result = applySuggestedLearningPriceToItems(items, 8000);
    expect(result.ok).toBe(true);
    expect(result.items[0]!.amount).toBe(8000);
    expect(result.items[1]!.unitPrice).toBe(320);
    expect(result.items[1]!.amount).toBe(0);
  });

  it("falls back to other billable lines when no crew money", () => {
    const items = [
      {
        id: "1",
        description: "Menu design package",
        quantity: 1,
        unitPrice: 3000,
        amount: 3000,
        category: "other" as const,
      },
      {
        id: "2",
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
        amount: 320,
        category: "transport" as const,
      },
    ];
    const result = applySuggestedLearningPriceToItems(items, 4500);
    expect(result.ok).toBe(true);
    expect(result.items[0]!.amount).toBe(4500);
    expect(result.items[1]!.amount).toBe(320);
  });

  it("returns error when nothing adjustable", () => {
    const items = [
      {
        id: "1",
        description: "Transportation Fee",
        quantity: 1,
        unitPrice: 320,
        amount: 320,
        category: "transport" as const,
      },
    ];
    const result = applySuggestedLearningPriceToItems(items, 5000);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/可調整/);
    expect(result.items[0]!.amount).toBe(320);
  });

  it("rejects non-positive target", () => {
    const items = [
      {
        id: "1",
        description: "Event Photoshoot",
        quantity: 1,
        unitPrice: 4000,
        amount: 4000,
        category: "photographer_crew" as const,
      },
    ];
    expect(applySuggestedLearningPriceToItems(items, 0).ok).toBe(false);
    expect(applySuggestedLearningPriceToItems(items, -100).ok).toBe(false);
  });
});
