import { extractHoursFromText } from "./quoteHoursText";
import { quotePricingMode } from "./quotePricingMode";

export type QuoteItemQuantityLike = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
};

export type HourlyQuantityAdjustment = {
  description: string;
  previousQuantity: number;
  nextQuantity: number;
  hoursFromText: number;
};

/** Fixed-fee / included lines — quantity is not hours even if text mentions time. */
const SKIP_HOURLY_QTY_RE =
  /transportation|team\s*\d+\s*p|retouch|equipment|delivery|post[- ]?production|lighting|訂金|交通|運輸|background|styled\s*bg|免費|included/i;

export function shouldReconcileHourlyQuantity(description: string): boolean {
  const d = description.trim();
  if (!d || SKIP_HOURLY_QTY_RE.test(d)) return false;
  return extractHoursFromText(d) != null;
}

/**
 * When a per-hour line item description states N hours but quantity ≠ N,
 * align quantity (and amount) to the described hours for time_crew quotes.
 */
export function reconcileHourlyQuoteItems<T extends QuoteItemQuantityLike>(
  serviceType: string,
  items: T[]
): { items: T[]; adjustments: HourlyQuantityAdjustment[] } {
  if (quotePricingMode(serviceType) !== "time_crew") {
    return { items, adjustments: [] };
  }

  const adjustments: HourlyQuantityAdjustment[] = [];
  const next = items.map((item) => {
    const desc = item.description?.trim() ?? "";
    if (!shouldReconcileHourlyQuantity(desc)) return item;

    const hours = extractHoursFromText(desc);
    if (hours == null || hours <= 0) return item;

    const qty = Number(item.quantity) || 0;
    if (qty === hours) return item;

    adjustments.push({
      description: desc,
      previousQuantity: qty,
      nextQuantity: hours,
      hoursFromText: hours,
    });

    const unitPrice = Number(item.unitPrice) || 0;
    return {
      ...item,
      quantity: hours,
      amount: hours * unitPrice,
    };
  });

  return { items: next, adjustments };
}

export function formatHourlyQuantityAdjustments(
  adjustments: HourlyQuantityAdjustment[]
): string {
  return adjustments
    .map((a) => {
      const label =
        a.description.length > 36
          ? `${a.description.slice(0, 36)}…`
          : a.description;
      return `「${label}」數量 ${a.previousQuantity}→${a.nextQuantity}（描述 ${a.hoursFromText} 小時）`;
    })
    .join("；");
}
