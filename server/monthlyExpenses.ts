import { and, sql } from "drizzle-orm";
import type { getDb } from "./db";
type ExpenseDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
import { expenses } from "../drizzle/schema";

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  transport: "車費",
  equipment_rent: "租用器材",
  equipment_buy: "購買器材",
  staff: "員工薪酬",
  post_production: "後期製作",
  software: "軟件/訂閱",
  marketing: "市場推廣",
  office: "辦公室/場地",
  other: "其他",
};

/** Both pages use the database calendar month, not Node's local timezone. */
export function expenseMonthCondition(year: number, month: number) {
  return and(
    sql`YEAR(${expenses.date}) = ${year}`,
    sql`MONTH(${expenses.date}) = ${month}`,
  );
}

type ExpenseAggregate = {
  category: string;
  total: string | number | null;
  count: string | number;
  syncedTotal: string | number | null;
};

/** Work in cents so category totals and the grand total stay identical. */
export function summarizeMonthlyExpenses(rows: ExpenseAggregate[]) {
  let totalCents = 0;
  let syncedCents = 0;
  const summary = rows.map((row) => {
    const cents = Math.round(Number(row.total ?? 0) * 100);
    totalCents += cents;
    syncedCents += Math.round(Number(row.syncedTotal ?? 0) * 100);
    return {
      category: row.category,
      categoryLabel: EXPENSE_CATEGORY_LABELS[row.category] ?? row.category,
      total: cents / 100,
      count: Number(row.count) || 0,
    };
  });
  return {
    summary,
    grandTotal: totalCents / 100,
    overheadExpenses: (totalCents - syncedCents) / 100,
    syncedProjectExpenses: syncedCents / 100,
  };
}

/** expenses is the ledger of record; never add quote_costs again to this sum. */
export async function getMonthlyExpenseSummary(db: ExpenseDatabase, year: number, month: number) {
  const rows = await db.select({
    category: expenses.category,
    total: sql<string>`SUM(${expenses.amount})`,
    count: sql<string>`COUNT(*)`,
    syncedTotal: sql<string>`SUM(CASE WHEN ${expenses.quoteCostId} IS NOT NULL THEN ${expenses.amount} ELSE 0 END)`,
  }).from(expenses)
    .where(expenseMonthCondition(year, month))
    .groupBy(expenses.category);
  return summarizeMonthlyExpenses(rows);
}

export function calculateExpenseNetProfit(revenue: number, adSpend: number, allExpenses: number) {
  return (Math.round(revenue * 100) - Math.round(adSpend * 100) - Math.round(allExpenses * 100)) / 100;
}
