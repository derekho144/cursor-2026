import { describe, it, expect } from "vitest";
import {
  mapQuoteCostCategoryToExpense,
  formatQuoteCostExpenseDescription,
  resolveExpenseDateFromQuote,
} from "./quoteCostExpenseSync";

describe("quoteCostExpenseSync", () => {
  it("maps overlapping categories 1:1", () => {
    expect(mapQuoteCostCategoryToExpense("transport")).toBe("transport");
    expect(mapQuoteCostCategoryToExpense("equipment_rent")).toBe("equipment_rent");
    expect(mapQuoteCostCategoryToExpense("staff")).toBe("staff");
  });

  it("maps quote-only categories to closest expense bucket", () => {
    expect(mapQuoteCostCategoryToExpense("freelancer")).toBe("staff");
    expect(mapQuoteCostCategoryToExpense("venue")).toBe("office");
    expect(mapQuoteCostCategoryToExpense("post_production")).toBe("other");
  });

  it("formats expense description with quote number", () => {
    expect(
      formatQuoteCostExpenseDescription("Q-001", "Acme", "外判攝影師")
    ).toBe("[報價 Q-001 · Acme] 外判攝影師");
  });

  it("uses shooting date when valid", () => {
    const d = resolveExpenseDateFromQuote("2026-09-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(15);
  });

  it("falls back when shooting date missing", () => {
    const fallback = new Date("2026-01-02T12:00:00");
    expect(resolveExpenseDateFromQuote(null, fallback)).toEqual(fallback);
  });
});
