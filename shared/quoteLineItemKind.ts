/**
 * Classify quote line items so photographer-crew money
 * is not mixed with photobooth / video / other add-ons.
 */

export type QuoteLineItemKind =
  | "photographer_crew"
  | "photobooth"
  | "video"
  | "transport"
  | "included_meta"
  | "other";

/** Stored / explicit categories (same as kinds). */
export type QuoteLineItemCategory = QuoteLineItemKind;

export const QUOTE_LINE_ITEM_CATEGORY_OPTIONS: Array<{
  value: QuoteLineItemCategory;
  label: string;
}> = [
  { value: "photographer_crew", label: "攝影師" },
  { value: "photobooth", label: "Photobooth" },
  { value: "video", label: "錄影" },
  { value: "transport", label: "交通" },
  { value: "included_meta", label: "附註／包含" },
  { value: "other", label: "其他服務" },
];

export const QUOTE_LINE_ITEM_KINDS = QUOTE_LINE_ITEM_CATEGORY_OPTIONS.map(
  (o) => o.value
) as QuoteLineItemCategory[];

export function isQuoteLineItemCategory(
  raw: unknown
): raw is QuoteLineItemCategory {
  return (
    typeof raw === "string" &&
    (QUOTE_LINE_ITEM_KINDS as string[]).includes(raw)
  );
}

export function quoteLineItemCategoryLabel(
  kind: QuoteLineItemKind | null | undefined
): string {
  if (!kind) return "自動";
  return (
    QUOTE_LINE_ITEM_CATEGORY_OPTIONS.find((o) => o.value === kind)?.label ??
    kind
  );
}

export type QuoteLineAmountInput = {
  description?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  amount?: number | string | null;
  /** Explicit category from UI; when set, overrides keyword inference */
  category?: QuoteLineItemCategory | string | null;
};

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

/** Normalize description for keyword matching. */
export function normalizeLineDescription(
  description: string | null | undefined
): string {
  return String(description ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a single quote line by description.
 * Order matters: photobooth / transport / video / meta before generic photo.
 */
export function classifyQuoteLineItem(
  description: string | null | undefined
): QuoteLineItemKind {
  const d = normalizeLineDescription(description);
  if (!d) return "other";

  if (
    /photo\s*-?\s*booth|photobooth|photo booth|即影即有|照相亭|相片亭/.test(d) ||
    (/無限相紙|拍照道具/.test(d) && /打印|道具|相紙/.test(d))
  ) {
    return "photobooth";
  }

  if (
    /transportation|transport fee|\btransport\b|車費|交通|\btravel\b/.test(d)
  ) {
    return "transport";
  }

  if (
    /videograph|videography|\bvideo\b|錄影|攝像|短片|影片製作|filming session|short film/.test(
      d
    ) &&
    !/photo/.test(d)
  ) {
    return "video";
  }

  if (
    /^team\s*\d*\s*p\b/.test(d) ||
    /^team\s+\d+p\b/.test(d) ||
    /lighting\s*&?\s*equipment|camera\/|delivery method|first cut delivery|by links/.test(
      d
    ) ||
    (/^retouch\b/.test(d) && /included/.test(d))
  ) {
    return "included_meta";
  }

  if (
    /event\s*photoshoot|photoshoot|photo\s*shoot|photography|photographer|extra\s*photographer|additional\s*photographer|攝影師|攝影服務|活動攝影|跟拍|extra\s*hour|extra\s*photos?|合照|細節圖/.test(
      d
    )
  ) {
    return "photographer_crew";
  }

  if (/product\s*photo|白底|食物攝影|珠寶攝影|artwork\s*photo|作品特寫/.test(d)) {
    return "photographer_crew";
  }

  return "other";
}

/** Prefer explicit category; fall back to keyword classification. */
export function resolveQuoteLineItemKind(input: {
  description?: string | null;
  category?: QuoteLineItemCategory | string | null;
}): QuoteLineItemKind {
  if (isQuoteLineItemCategory(input.category)) return input.category;
  return classifyQuoteLineItem(input.description);
}

export type QuoteMoneySplit = {
  photographerCrewSubtotal: number;
  photoboothSubtotal: number;
  videoSubtotal: number;
  transportSubtotal: number;
  otherBillableSubtotal: number;
  includedMetaSubtotal: number;
  itemsTotal: number;
  learningTotal: number;
  learningTotalSource: "photographer_crew" | "items_total";
  hasPhotographerCrewLines: boolean;
  hasNonCrewBillables: boolean;
};

export function splitQuoteLineItemMoney(
  items: QuoteLineAmountInput[] | null | undefined
): QuoteMoneySplit {
  const list = Array.isArray(items) ? items : [];
  let photographerCrewSubtotal = 0;
  let photoboothSubtotal = 0;
  let videoSubtotal = 0;
  let transportSubtotal = 0;
  let otherBillableSubtotal = 0;
  let includedMetaSubtotal = 0;
  let itemsTotal = 0;

  for (const item of list) {
    const amount = lineAmount(item);
    itemsTotal += amount;
    const kind = resolveQuoteLineItemKind(item);
    switch (kind) {
      case "photographer_crew":
        photographerCrewSubtotal += amount;
        break;
      case "photobooth":
        photoboothSubtotal += amount;
        break;
      case "video":
        videoSubtotal += amount;
        break;
      case "transport":
        transportSubtotal += amount;
        break;
      case "included_meta":
        includedMetaSubtotal += amount;
        break;
      default:
        otherBillableSubtotal += amount;
        break;
    }
  }

  const hasPhotographerCrewLines = photographerCrewSubtotal > 0;
  const learningTotal = hasPhotographerCrewLines
    ? photographerCrewSubtotal
    : itemsTotal;
  const learningTotalSource = hasPhotographerCrewLines
    ? "photographer_crew"
    : "items_total";

  const hasNonCrewBillables =
    photoboothSubtotal + videoSubtotal + otherBillableSubtotal > 0;

  return {
    photographerCrewSubtotal: Math.round(photographerCrewSubtotal * 100) / 100,
    photoboothSubtotal: Math.round(photoboothSubtotal * 100) / 100,
    videoSubtotal: Math.round(videoSubtotal * 100) / 100,
    transportSubtotal: Math.round(transportSubtotal * 100) / 100,
    otherBillableSubtotal: Math.round(otherBillableSubtotal * 100) / 100,
    includedMetaSubtotal: Math.round(includedMetaSubtotal * 100) / 100,
    itemsTotal: Math.round(itemsTotal * 100) / 100,
    learningTotal: Math.round(learningTotal * 100) / 100,
    learningTotalSource,
    hasPhotographerCrewLines,
    hasNonCrewBillables,
  };
}

/**
 * Lines that must not receive % discount: transport / 交通費, and expedited / 加急.
 * Matches explicit category=transport and legacy description keywords.
 */
export function isNonDiscountableQuoteLine(
  item: QuoteLineAmountInput
): boolean {
  if (resolveQuoteLineItemKind(item) === "transport") return true;
  const d = normalizeLineDescription(item.description);
  if (!d) return false;
  return /expedited|加急|urgent\s*fee|rush\s*fee|express\s*fee/.test(d);
}

/** Subtotal used for discountPercent — excludes transport and expedited fees. */
export function computeDiscountableSubtotal(
  items: QuoteLineAmountInput[] | null | undefined
): number {
  const list = Array.isArray(items) ? items : [];
  let sum = 0;
  for (const item of list) {
    if (isNonDiscountableQuoteLine(item)) continue;
    sum += lineAmount(item);
  }
  return Math.round(sum * 100) / 100;
}

/** discountableSubtotal × percent / 100 (2 d.p.). */
export function computeQuoteDiscountAmount(
  items: QuoteLineAmountInput[] | null | undefined,
  discountPercent: number | null | undefined
): number {
  const pct = Number(discountPercent) || 0;
  if (pct <= 0) return 0;
  const base = computeDiscountableSubtotal(items);
  return Math.round((base * pct) / 100 * 100) / 100;
}

/** Prefer photographer-crew subtotal for learning; fall back to quote total. */
export function resolveLearningTotal(input: {
  items?: QuoteLineAmountInput[] | null;
  quoteTotal?: number | null;
}): {
  learningTotal: number;
  quoteTotal: number;
  split: QuoteMoneySplit;
} {
  const split = splitQuoteLineItemMoney(input.items);
  const quoteTotalRaw =
    input.quoteTotal != null && Number.isFinite(Number(input.quoteTotal))
      ? Number(input.quoteTotal)
      : split.itemsTotal;
  const quoteTotal = Math.round(quoteTotalRaw * 100) / 100;
  const learningTotal =
    split.hasPhotographerCrewLines && split.photographerCrewSubtotal > 0
      ? split.photographerCrewSubtotal
      : quoteTotal > 0
        ? quoteTotal
        : split.itemsTotal;
  return {
    learningTotal: Math.round(learningTotal * 100) / 100,
    quoteTotal,
    split,
  };
}
