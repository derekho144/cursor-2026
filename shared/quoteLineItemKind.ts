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

export type QuoteLineAmountInput = {
  description?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  amount?: number | string | null;
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
export function normalizeLineDescription(description: string | null | undefined): string {
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

  // Photobooth / instant print booth (NOT event photographer coverage)
  if (
    /photo\s*-?\s*booth|photobooth|photo booth|即影即有|照相亭|相片亭/.test(d) ||
    (/無限相紙|拍照道具/.test(d) && /打印|道具|相紙/.test(d))
  ) {
    return "photobooth";
  }

  if (
    /transportation|transport fee|\btransport\b|車費|交通費|\btravel\b/.test(d)
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

  // $0 meta / included lines (Team XP, lighting list, delivery method)
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

  // Photographer / event stills coverage (incl. extra photographer)
  if (
    /event\s*photoshoot|photoshoot|photo\s*shoot|photography|photographer|extra\s*photographer|additional\s*photographer|攝影師|攝影服務|活動攝影|跟拍/.test(
      d
    )
  ) {
    return "photographer_crew";
  }

  // Chinese / EN product stills still count as photo crew money for learning
  if (/product\s*photo|白底|食物攝影|珠寶攝影|artwork\s*photo|作品特寫/.test(d)) {
    return "photographer_crew";
  }

  return "other";
}

export type QuoteMoneySplit = {
  /** Sum of photographer_crew line amounts */
  photographerCrewSubtotal: number;
  photoboothSubtotal: number;
  videoSubtotal: number;
  transportSubtotal: number;
  otherBillableSubtotal: number;
  includedMetaSubtotal: number;
  /** Full sum of all line amounts */
  itemsTotal: number;
  /**
   * Money used for crew/time learning:
   * photographer crew when present, else full items total.
   */
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
    const kind = classifyQuoteLineItem(item.description);
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
