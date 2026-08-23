/**
 * Map quote_costs.category → expenses.category
 * Quote-only categories fall back to closest expense bucket.
 */
export type QuoteCostCategory =
  | "freelancer"
  | "venue"
  | "post_production"
  | "transport"
  | "equipment_rent"
  | "equipment_buy"
  | "staff"
  | "other";

export type ExpenseCategory =
  | "transport"
  | "equipment_rent"
  | "equipment_buy"
  | "staff"
  | "software"
  | "marketing"
  | "office"
  | "other";

const MAP: Record<QuoteCostCategory, ExpenseCategory> = {
  freelancer: "staff",
  venue: "office",
  post_production: "other",
  transport: "transport",
  equipment_rent: "equipment_rent",
  equipment_buy: "equipment_buy",
  staff: "staff",
  other: "other",
};

export function mapQuoteCostCategoryToExpense(
  category: QuoteCostCategory | string
): ExpenseCategory {
  return MAP[category as QuoteCostCategory] ?? "other";
}

/** Build expense description shown on 收入及支出. */
export function formatQuoteCostExpenseDescription(
  quoteNumber: string,
  clientName: string | null | undefined,
  description: string
): string {
  const client = (clientName || "").trim();
  const prefix = client
    ? `[報價 ${quoteNumber} · ${client}]`
    : `[報價 ${quoteNumber}]`;
  const body = description.trim();
  const full = `${prefix} ${body}`;
  return full.length > 512 ? full.slice(0, 512) : full;
}

/** Prefer shooting date; fall back to today (local date string YYYY-MM-DD → Date). */
export function resolveExpenseDateFromQuote(
  shootingDate: string | null | undefined,
  fallback: Date = new Date()
): Date {
  const raw = (shootingDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(`${raw.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}
