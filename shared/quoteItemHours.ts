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

/** HKD: half-day / full-day package totals — qty 1 is intentional. */
const FLAT_PACKAGE_UNIT_MIN = 3500;

const PER_HOUR_SIGNAL_RE =
  /\b(per\s*hour|per\s*hr|\/\s*hr|hourly|每小時|\/小時|按鐘|每小時計)\b/i;

const FLAT_PACKAGE_SIGNAL_RE =
  /\b(package|flat\s*fee|flat\s*rate|all[- ]?inclusive|一口價|全包|套餐)\b/i;

/**
 * Add-on packages priced as one block for N hours / full day
 * (PhotoBooth 2小時, PhotoPrint, 全天直播) — qty must stay 1.
 */
const FLAT_ADDON_PACKAGE_RE =
  /photo\s*booth|photobooth|photo\s*print|photoprint|圖片直播|人面識別|live\s*stream|livestream/i;

/** Duration written as package length, e.g. "(2小時)" / "(8 hours)", not "per hour". */
const PACKAGE_DURATION_PARENS_RE =
  /\(\s*\d+(?:\.\d+)?\s*(?:小時|小时|hrs?|hours?)\s*\)/i;

const FULL_DAY_PACKAGE_RE = /全(?:天|日)|full\s*[- ]?day/i;

/**
 * True when the line is a flat package (qty should be 1), regardless of current qty.
 * Does not depend on qty===1 so we can reverse mistaken hourly alignment.
 */
export function looksLikeFlatPackageLineItem(
  item: QuoteItemQuantityLike,
  hours: number
): boolean {
  const unitPrice = Number(item.unitPrice) || 0;
  if (hours <= 0) return false;

  const desc = item.description?.trim() ?? "";
  if (!desc) return false;
  if (PER_HOUR_SIGNAL_RE.test(desc)) return false;
  if (FLAT_PACKAGE_SIGNAL_RE.test(desc)) return true;
  if (FLAT_ADDON_PACKAGE_RE.test(desc)) return true;
  if (FULL_DAY_PACKAGE_RE.test(desc)) return true;
  // Parenthetical hours alone are not enough (e.g. "Event Photography (8 hours)"
  // @ low hourly rate still needs qty=hours). Combine with high package total.
  if (PACKAGE_DURATION_PARENS_RE.test(desc) && unitPrice >= FLAT_PACKAGE_UNIT_MIN) {
    return true;
  }

  // e.g. Event Photography 8 hours @ HKD 7,000 — package total, not per-hour
  return unitPrice >= FLAT_PACKAGE_UNIT_MIN;
}

export function shouldReconcileHourlyQuantity(description: string): boolean {
  const d = description.trim();
  if (!d || SKIP_HOURLY_QTY_RE.test(d)) return false;
  return extractHoursFromText(d) != null;
}

/**
 * For time_crew quotes:
 * - Per-hour lines: align quantity to hours stated in the description.
 * - Flat packages (booth/print/全日/高單價套餐): keep / restore quantity = 1.
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
    const unitPrice = Number(item.unitPrice) || 0;

    if (looksLikeFlatPackageLineItem(item, hours)) {
      // Undo mistaken "qty = hours" on package add-ons (e.g. PhotoBooth 2小時).
      if (qty !== 1 && qty === hours) {
        adjustments.push({
          description: desc,
          previousQuantity: qty,
          nextQuantity: 1,
          hoursFromText: hours,
        });
        return {
          ...item,
          quantity: 1,
          amount: unitPrice,
        };
      }
      return item;
    }

    if (qty === hours) return item;

    adjustments.push({
      description: desc,
      previousQuantity: qty,
      nextQuantity: hours,
      hoursFromText: hours,
    });

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
