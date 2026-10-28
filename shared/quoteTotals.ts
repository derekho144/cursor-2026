/**
 * Single source of truth for quote money totals from line items.
 * Prefer stored `amount` (supports waived lines: unitPrice > 0, amount = 0).
 */

import { computeQuoteDiscountAmount } from "./quoteDiscount";
import type { QuoteLineAmountInput } from "./quoteLineItemKind";

export function quoteLineAmount(item: QuoteLineAmountInput): number {
  if (item.amount != null && item.amount !== "") {
    const a = Number(item.amount);
    if (Number.isFinite(a)) return a;
  }
  const q = Number(item.quantity ?? 0);
  const u = Number(item.unitPrice ?? 0);
  if (Number.isFinite(q) && Number.isFinite(u)) return q * u;
  return 0;
}

export function computeQuoteTotalsFromItems(
  items: QuoteLineAmountInput[],
  discountPercent: number
): {
  subtotal: number;
  discountAmount: number;
  total: number;
} {
  const subtotal =
    Math.round(
      items.reduce((sum, it) => sum + quoteLineAmount(it), 0) * 100
    ) / 100;
  const discountAmount = computeQuoteDiscountAmount(items, discountPercent);
  const total = Math.max(
    0,
    Math.round((subtotal - discountAmount) * 100) / 100
  );
  return { subtotal, discountAmount, total };
}

/** True when two money figures differ beyond floating-point noise. */
export function quoteMoneyDiffers(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  eps = 0.02
): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return true;
  return Math.abs(na - nb) > eps;
}
