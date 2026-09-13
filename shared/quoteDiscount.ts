/**
 * Membership / % discounts apply to billable services only.
 * Transportation and rush/expedited fees are never discounted.
 */
import {
  resolveQuoteLineItemKind,
  type QuoteLineAmountInput,
} from "./quoteLineItemKind";

function lineAmount(item: QuoteLineAmountInput): number {
  if (item.amount != null && item.amount !== "") {
    const a = Number(item.amount);
    if (Number.isFinite(a)) return a;
  }
  const q = Number(item.quantity ?? 0);
  const u = Number(item.unitPrice ?? 0);
  if (Number.isFinite(q) && Number.isFinite(u)) return q * u;
  return 0;
}

/** Rush / expedited fees — exclude from % discount (same policy as transport). */
export function isExpeditedFeeDescription(
  description: string | null | undefined
): boolean {
  const d = String(description ?? "").toLowerCase();
  return /expedited|加急|urgent fee|rush fee|express fee/.test(d);
}

export function isDiscountExcludedQuoteLine(
  item: QuoteLineAmountInput
): boolean {
  if (resolveQuoteLineItemKind(item) === "transport") return true;
  if (isExpeditedFeeDescription(item.description)) return true;
  return false;
}

export function discountableQuoteSubtotal(
  items: QuoteLineAmountInput[]
): number {
  const sum = items.reduce((acc, item) => {
    if (isDiscountExcludedQuoteLine(item)) return acc;
    return acc + lineAmount(item);
  }, 0);
  return Math.round(sum * 100) / 100;
}

/** Percent discount on discountable subtotal only (not transport / rush). */
export function computeQuoteDiscountAmount(
  items: QuoteLineAmountInput[],
  discountPercent: number
): number {
  const pct = Number(discountPercent) || 0;
  if (pct <= 0) return 0;
  const base = discountableQuoteSubtotal(items);
  return Math.round((base * pct) / 100);
}
