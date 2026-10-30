import { describe, it, expect } from "vitest";
import {
  mapQuoteCostCategoryToExpense,
  formatQuoteCostExpenseDescription,
  resolveExpenseDateFromQuote,
  hkCalendarDateAtNoon,
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
    expect(mapQuoteCostCategoryToExpense("post_production")).toBe("post_production");
  });

  it("formats expense description with quote number", () => {
    expect(
      formatQuoteCostExpenseDescription("Q-001", "Acme", "外判攝影師")
    ).toBe("[報價 Q-001 · Acme] 外判攝影師");
  });

  it("uses shooting date when valid", () => {
    const d = resolveExpenseDateFromQuote(
      "2026-09-15",
      "2026-01-02T04:00:00.000Z"
    );
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(15);
  });

  it("falls back to quote createdAt (HK calendar), not add-time", () => {
    const addTime = new Date("2026-10-30T15:00:00.000Z");
    const d = resolveExpenseDateFromQuote(
      null,
      "2026-09-08T16:30:00.000Z",
      addTime
    );
    // 2026-09-08 16:30 UTC = 2026-09-09 00:30 HKT → HK calendar Sep 9
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(9);
  });

  it("falls back to provided default only when quote has no dates", () => {
    const fallback = new Date("2026-01-02T12:00:00");
    expect(resolveExpenseDateFromQuote(null, null, fallback)).toEqual(fallback);
  });

  it("hkCalendarDateAtNoon uses Asia/Hong_Kong", () => {
    const d = hkCalendarDateAtNoon("2026-09-08T16:30:00.000Z");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8);
    expect(d!.getDate()).toBe(9);
  });
});
