/**
 * RAW / ARW file delivery — paid add-on when clients request camera originals.
 * Standard quotes deliver retouched JPEG/TIFF by link; RAW/ARW is extra.
 */

export const ARW_RAW_DELIVERY_DESCRIPTION = "RAW / ARW File Delivery";
/** Flat per-shoot add-on (HKD). */
export const ARW_RAW_DELIVERY_UNIT_PRICE = 1000;

export function hasArwRawDeliverySignal(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;

  // Strong: explicit ARW / .arw
  if (/\barw\b/i.test(t) || /\.arw\b/i.test(t)) return true;
  if (/\b(?:raw|arw)\s*\/\s*(?:raw|arw)\b/i.test(t)) return true;

  // RAW files in photography deliverable context
  if (/\b(?:camera\s*)?raw\s+files?\b/i.test(t)) return true;
  if (/\braw\s+(?:photo|image|format|data)\b/i.test(t)) return true;
  if (
    /\b(?:deliver|provide|submit|return|hand\s*over|supply|furnish|upload)[^\n]{0,80}\braw\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(?:jpeg|jpg|tiff|tif)[^\n]{0,50}\b(?:and|&|\+|\/)\s*(?:raw|arw)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(?:raw|arw)\b[^\n]{0,50}\b(?:and|&|\+|\/)\s*(?:jpeg|jpg|tiff|tif)\b/i.test(
      t
    )
  ) {
    return true;
  }

  // Chinese deliverable wording
  if (/原檔|原始檔|原始相片|RAW檔|ARW檔|原相格式|相機原檔|相機原始檔/.test(t)) {
    return true;
  }
  if (/(?:交付|提供|交回|回交|附上|遞交).{0,40}(?:原檔|RAW|ARW)/i.test(t)) {
    return true;
  }

  // Other camera RAW extensions when requested as deliverables
  if (/\b(?:dng|cr2|cr3|nef)\s+files?\b/i.test(t)) return true;

  return false;
}

export function suggestedItemsIncludeArwRaw(
  items: Array<{ description?: string | null }> | null | undefined
): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((it) => {
    const d = String(it?.description ?? "").toLowerCase();
    if (/\barw\b/.test(d)) return true;
    if (/\braw\b/.test(d) && /file|deliver|format|原檔|原始/.test(d)) return true;
    if (/原檔|原始檔/.test(d)) return true;
    return false;
  });
}

export function buildArwRawDeliveryLineItem(): {
  description: string;
  quantity: number;
  unitPrice: number;
} {
  return {
    description: ARW_RAW_DELIVERY_DESCRIPTION,
    quantity: 1,
    unitPrice: ARW_RAW_DELIVERY_UNIT_PRICE,
  };
}

/** Re-sync pricingMid/Low/High after programmatic suggestedItems changes. */
export function syncInquiryPricingFromItems(parsed: Record<string, unknown>): void {
  const items = parsed.suggestedItems;
  if (!Array.isArray(items) || items.length === 0) return;
  const total = items.reduce((sum: number, item: unknown) => {
    const row = item as { quantity?: unknown; unitPrice?: unknown };
    return sum + (Number(row.quantity) || 1) * (Number(row.unitPrice) || 0);
  }, 0);
  if (total <= 0) return;
  const mid = Math.round(total);
  parsed.pricingMid = mid;
  parsed.pricingLow = Math.round((mid * 0.7) / 100) * 100;
  parsed.pricingHigh = Math.round((mid * 1.35) / 100) * 100;
}

/** Prompt snippet for email inquiry billing rules. */
export function arwRawDeliveryBillingRulesText(): string {
  return `
raw / arw file delivery (EXTRA CHARGE — CRITICAL ADD-ON)
  - When the client requests RAW / ARW / camera original files (Sony .ARW or other RAW formats) as deliverables, ALWAYS add a SEPARATE line item:
      description: "${ARW_RAW_DELIVERY_DESCRIPTION}"
      quantity: 1 (per shoot / job unless email states per-image)
      unitPrice: HKD ${ARW_RAW_DELIVERY_UNIT_PRICE} (flat add-on; extra paid service — NOT included in standard JPEG delivery)
  - Trigger keywords: ARW, .arw, RAW file, camera raw, 原檔, 原始檔, RAW檔, ARW檔, DNG/CR2/NEF when requested as deliverables
  - This is EXTRA. Standard event/product quotes deliver retouched JPEG/TIFF by link — RAW/ARW is always a separate charge.
  - Example: Event Photography 3h + RAW/ARW File Delivery HKD ${ARW_RAW_DELIVERY_UNIT_PRICE} + Transportation HKD 320.
`.trim();
}
