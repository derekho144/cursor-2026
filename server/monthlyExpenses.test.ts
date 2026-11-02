import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { expenses } from "../drizzle/schema";
import { calculateExpenseNetProfit, expenseMonthCondition, getMonthlyExpenseSummary, summarizeMonthlyExpenses } from "./monthlyExpenses";

const octoberRows = [
  { category: "staff", total: "49000.00", count: "6", syncedTotal: "49000.00" },
  { category: "equipment_rent", total: "1560.00", count: "3", syncedTotal: "1560.00" },
  { category: "transport", total: "1213.00", count: "6", syncedTotal: "1213.00" },
  { category: "other", total: "460.39", count: "3", syncedTotal: "460.39" },
  { category: "software", total: "3214.00", count: "3", syncedTotal: "0" },
  { category: "office", total: "2800.00", count: "1", syncedTotal: "0" },
  { category: "equipment_buy", total: "109.00", count: "1", syncedTotal: "0" },
];

describe("monthly expense ledger shared by dashboard and expenses", () => {
  it("includes all 23 October expenses and counts linked costs once", () => {
    const result = summarizeMonthlyExpenses(octoberRows);
    expect(result.grandTotal).toBe(58356.39);
    expect(result.overheadExpenses).toBe(6123);
    expect(result.syncedProjectExpenses).toBe(52233.39);
    expect(result.summary.reduce((n, r) => n + r.count, 0)).toBe(23);
    expect(result.summary.find(r => r.category === "staff")?.total).toBe(49000);
  });

  it("nets all ledger expenses plus advertising without subtracting quote costs again", () => {
    expect(calculateExpenseNetProfit(121795, 5372.19, 58356.39)).toBe(58066.42);
    expect(calculateExpenseNetProfit(121795, 0, 58356.39)).toBe(63438.61);
  });

  it("does not lose decimal cents when adding categories or subtracting", () => {
    const result = summarizeMonthlyExpenses([
      { category: "transport", total: "0.10", count: 1, syncedTotal: "0.10" },
      { category: "office", total: "0.20", count: 1, syncedTotal: "0" },
    ]);
    expect(result.grandTotal).toBe(0.3);
    expect(result.overheadExpenses).toBe(0.2);
    expect(calculateExpenseNetProfit(0.3, 0.1, 0.2)).toBe(0);
  });

  it("handles empty months and losses", () => {
    expect(summarizeMonthlyExpenses([])).toEqual({ summary: [], grandTotal: 0, overheadExpenses: 0, syncedProjectExpenses: 0 });
    expect(calculateExpenseNetProfit(0, 10.05, 20.1)).toBe(-30.15);
  });

  it("counts synced expenses regardless of the related quote status", () => {
    // The ledger is authoritative even if a linked quote is later rejected.
    expect(summarizeMonthlyExpenses([{ category: "staff", total: "800", count: 1, syncedTotal: "800" }]).grandTotal).toBe(800);
  });

  it("uses the same database year/month including all last-day fractional seconds", () => {
    const query = new MySqlDialect().sqlToQuery(expenseMonthCondition(2026, 10)!);
    expect(query.params).toEqual([2026, 10]);
    expect(query.sql).toContain('YEAR(`expenses`.`date`)');
    expect(query.sql).toContain('MONTH(`expenses`.`date`)');
    expect(query.sql).not.toContain('23:59:59');
    expect(query.sql).not.toContain('quote_cost_id');
  });

  it("queries expenses only, not a join that can duplicate or drop linked costs", async () => {
    const groupBy = vi.fn().mockResolvedValue(octoberRows);
    const where = vi.fn(() => ({ groupBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const result = await getMonthlyExpenseSummary({ select } as any, 2026, 10);
    expect(from).toHaveBeenCalledWith(expenses);
    expect(where).toHaveBeenCalledOnce();
    expect(result.grandTotal).toBe(58356.39);
    expect(Object.keys(select.mock.calls[0]?.[0] ?? {})).toEqual(['category', 'total', 'count', 'syncedTotal']);
  });
});
