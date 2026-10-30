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
  | "post_production"
  | "software"
  | "marketing"
  | "office"
  | "other";

const MAP: Record<QuoteCostCategory, ExpenseCategory> = {
  freelancer: "staff",
  venue: "office",
  post_production: "post_production",
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

/** Calendar YYYY-MM-DD in Asia/Hong_Kong → Date at local noon. */
export function hkCalendarDateAtNoon(input: Date | string): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const out = new Date(`${ymd}T12:00:00`);
  return Number.isNaN(out.getTime()) ? null : out;
}

/**
 * Expense date for quote-cost sync — same month attribution as 收入:
 * shootingDate → quote createdAt (HK calendar) → fallback.
 * Never use "when the cost was clicked add" unless no quote dates exist.
 */
export function resolveExpenseDateFromQuote(
  shootingDate: string | null | undefined,
  quoteCreatedAt?: Date | string | null,
  fallback: Date = new Date()
): Date {
  const raw = (shootingDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(`${raw.slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (quoteCreatedAt != null && quoteCreatedAt !== "") {
    const fromCreated = hkCalendarDateAtNoon(quoteCreatedAt);
    if (fromCreated) return fromCreated;
  }
  return fallback;
}
