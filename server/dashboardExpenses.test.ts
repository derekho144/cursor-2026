import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), monthly: vi.fn() }));
vi.mock("mysql2", () => ({ default: { createPool: vi.fn(() => ({})) } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: vi.fn(() => ({ select: mocks.select })) }));
vi.mock("./monthlyExpenses", async () => {
  const original = await vi.importActual<typeof import("./monthlyExpenses")>("./monthlyExpenses");
  return { ...original, getMonthlyExpenseSummary: mocks.monthly };
});

import { adExpenses, quoteCosts, quotes } from "../drizzle/schema";
import { getDashboardStats, getDashboardStatsQuick } from "./db";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "mysql://test:test@localhost/test_readonly_mock");
  mocks.monthly.mockReset().mockResolvedValue({
    summary: [], grandTotal: 58356.39, overheadExpenses: 6123, syncedProjectExpenses: 52233.39,
  });
  mocks.select.mockReset().mockImplementation((fields: Record<string, unknown>) => {
    let table: unknown;
    const result = () => {
      if (table === quoteCosts) return [{ total: "52233.39" }];
      if (table === adExpenses) return fields?.platform ? [] : [{ total: "5372.19" }];
      if (table === quotes) {
        if (fields?.leadSource) return [];
        if (fields?.year) return [{ year: 2026, month: 10, revenue: "121795.00" }];
        return [{ count: 9, total: "121795.00" }];
      }
      return [];
    };
    const chain: any = {
      from: (t: unknown) => { table = t; return chain; },
      where: () => chain,
      innerJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  });
});

describe("dashboard quick/full expense alignment", () => {
  it.each([
    ["quick", getDashboardStatsQuick],
    ["full", getDashboardStats],
  ] as const)("%s uses the shared all-expense total, correct net profit and cost breakdown", async (_name, read) => {
    const data = await read(2026, 10);
    expect(mocks.monthly).toHaveBeenCalledWith(expect.anything(), 2026, 10);
    expect(data).toMatchObject({
      monthlyRevenue: 121795,
      adSpend: 5372.19,
      businessExpenses: 58356.39,
      overheadExpenses: 6123,
      syncedProjectExpenses: 52233.39,
      projectCosts: 52233.39,
      grossProfit: 69561.61,
      netProfit: 58066.42,
    });
  });
});
