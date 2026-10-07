/**
 * Conditional Quote 「SECTION B」 blocks by service type.
 *
 * Food  → 食物攝影與現場食物造型（全部為可選 Option，數量預設 0）
 * Event → 活動攝影與線上直播（B1 相片直播 $3500 / B2 快速交相 $800；數量預設 0）
 *
 * Persistence: plain line items (no DB migration).
 * - Section header: description starts with "SECTION B · …"
 * - Managed lines: description starts with B1 / B1.1 / B2
 * - Waived rush fee: unitPrice > 0 && amount === 0 && quantity > 0 (print shows strikethrough)
 * - Customer-facing: never label Section B lines as "Included" — use "Option"
 * - Transportation Fee: never strikethrough-waive
 * - Qty stays 0 until selected — hourly reconcile must not rewrite Section B qtys
 */

import { resolveQuoteLineItemKind } from "./quoteLineItemKind";

/** Default list price for event B1 QRCODE 相片直播. */
export const EVENT_LIVESTREAM_FEE_HKD = 3500;
/** Default list price for event B2 快速交相. */
export const EVENT_RUSH_FEE_HKD = 800;
/** Customer-facing label for every Section B add-on line. */
export const SECTION_B_OPTION_LABEL = "Option";

export type QuoteSectionBService =
  | "food_beverage"
  | "corporate_event";

export type SectionBLineSeed = {
  /** Stable id used when rebuilding the block */
  code: "HEADER" | "B1" | "B1.1" | "B2";
  description: string;
  quantity: number;
  unitPrice: number;
  /** Initial amount; waived rush uses 0 while unitPrice stays list price */
  amount: number;
};

const FOOD_SECTION_TITLE = "SECTION B · OPTIONAL · 食物攝影與現場食物造型";
const EVENT_SECTION_TITLE = "SECTION B · OPTIONAL · 活動攝影與線上直播";

export function isFoodPhotographyService(serviceType: string): boolean {
  return serviceType === "food_beverage";
}

export function isEventPhotographyService(serviceType: string): boolean {
  return serviceType === "corporate_event";
}

export function hasConditionalSectionB(serviceType: string): boolean {
  return isFoodPhotographyService(serviceType) || isEventPhotographyService(serviceType);
}

/** Section header row (full-bleed bar in print/PDF). */
export function isQuoteSectionHeader(description: string | null | undefined): boolean {
  return /^SECTION\s+[A-Z0-9]+/i.test(String(description ?? "").trim());
}

/** Leading item code for left column (B1, B1.1, C3, …). */
export function parseQuoteItemCode(description: string | null | undefined): string | null {
  const first = String(description ?? "").trim().split("\n")[0] ?? "";
  const m = first.match(/^([A-Z]\d+(?:\.\d+)?)\b/i);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Managed Section B rows we auto-inject / replace on service-type change.
 * Matches HEADER + B1 / B1.1 / B2 lines (not arbitrary user lines).
 */
export function isManagedSectionBItem(description: string | null | undefined): boolean {
  const d = String(description ?? "").trim();
  if (/^SECTION\s+B\b/i.test(d)) return true;
  return /^(B1(?:\.1)?|B2)\b/i.test(d);
}

/** Non-header Section B lines — always customer-facing options (never "Included"). */
export function isQuoteSectionBOptionItem(
  description: string | null | undefined
): boolean {
  const d = String(description ?? "").trim();
  if (!d || isQuoteSectionHeader(d)) return false;
  return isManagedSectionBItem(d);
}

export function isQuoteTbdPrice(description: string | null | undefined, unitPrice: number): boolean {
  if (Number(unitPrice) !== 0) return false;
  return /報價另議|tbd|to be (decided|advised|quoted)/i.test(String(description ?? ""));
}

/**
 * How UNIT PRICE / AMOUNT should render for a quote line.
 * Section B $0 add-ons → "Option" (not Included).
 */
export type QuotePriceDisplayKind =
  | "waived"
  | "tbd"
  | "option"
  | "included"
  | "money";

export function resolveQuotePriceDisplay(item: {
  description?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  amount?: number | string | null;
  isIncluded?: boolean | null;
}): QuotePriceDisplayKind {
  const desc = item.description;
  const qty = Number(item.quantity);
  const unitPrice = Number(item.unitPrice);
  const amount = Number(item.amount);

  // Unselected Section B option (qty 0): never treat as waived strikethrough
  if (isQuoteSectionBOptionItem(desc) && !(qty > 0)) {
    if (isQuoteTbdPrice(desc, unitPrice)) return "tbd";
    if (unitPrice > 0) return "money"; // show list price; amount stays 0
    return "option";
  }

  if (isQuoteWaivedPrice(unitPrice, amount, qty)) return "waived";
  if (isQuoteTbdPrice(desc, unitPrice)) return "tbd";
  // Section B add-ons: zero-price → Option; priced lines still show money
  if (isQuoteSectionBOptionItem(desc) && !(unitPrice > 0)) return "option";
  if (item.isIncluded || unitPrice === 0) return "included";
  return "money";
}

/**
 * List price shown with strikethrough; amount must stay 0 so totals exclude it.
 * quantity === 0 means unselected (not a waive).
 */
export function isQuoteWaivedPrice(
  unitPrice: number,
  amount: number,
  quantity?: number | null
): boolean {
  if (!(Number(unitPrice) > 0 && Number(amount) === 0)) return false;
  if (quantity != null && Number(quantity) === 0) return false;
  return true;
}

export function isEventRushFeeItem(description: string | null | undefined): boolean {
  const d = String(description ?? "");
  return /^B2\b/i.test(d.trim()) && /快速交相|12\s*小時|rush|expedited/i.test(d);
}

export function buildFoodSectionBLines(): SectionBLineSeed[] {
  return [
    {
      code: "HEADER",
      description: FOOD_SECTION_TITLE,
      quantity: 0,
      unitPrice: 0,
      amount: 0,
    },
    {
      code: "B1",
      description:
        "B1 拍攝前期策劃（Option）\n拍攝概念、Moodboard、及道具建議",
      quantity: 0,
      unitPrice: 0,
      amount: 0,
    },
    {
      code: "B1.1",
      description:
        "B1.1 現場藝術指導及食物造型（2 day · 9 hours per day）（Option）\n報價另議",
      quantity: 0,
      unitPrice: 0,
      amount: 0,
    },
  ];
}

export function buildEventSectionBLines(opts?: {
  /** When true, rush fee shows strikethrough / 豁免 (amount 0). Default unselected. */
  rushWaived?: boolean;
}): SectionBLineSeed[] {
  const waived = opts?.rushWaived === true;
  return [
    {
      code: "HEADER",
      description: EVENT_SECTION_TITLE,
      quantity: 0,
      unitPrice: 0,
      amount: 0,
    },
    {
      code: "B1",
      description: "B1 QRCODE 相片直播（Option）",
      quantity: 0,
      unitPrice: EVENT_LIVESTREAM_FEE_HKD,
      amount: 0,
    },
    {
      code: "B2",
      description: "B2 快速交相（12小時內）（Option）",
      // Default unselected (qty 0). Waived state keeps qty 1 so print shows strikethrough.
      quantity: waived ? 1 : 0,
      unitPrice: EVENT_RUSH_FEE_HKD,
      amount: 0,
    },
  ];
}

export function sectionBLinesForService(
  serviceType: string,
  opts?: { rushWaived?: boolean }
): SectionBLineSeed[] {
  if (isFoodPhotographyService(serviceType)) return buildFoodSectionBLines();
  if (isEventPhotographyService(serviceType)) return buildEventSectionBLines(opts);
  return [];
}

type ItemLike = {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  isIncluded?: boolean;
  category?: string;
};

/**
 * Drop previous managed Section B rows, then append the block for the new service type.
 * Preserves any existing rush-waived state when staying on event.
 */
export function applySectionBForServiceType<T extends ItemLike>(
  items: T[],
  serviceType: string,
  createId: () => string
): T[] {
  const preservedRushWaived = items.some(
    (it) =>
      isEventRushFeeItem(it.description) &&
      isQuoteWaivedPrice(Number(it.unitPrice), Number(it.amount), Number(it.quantity))
  );
  const without = items.filter((it) => !isManagedSectionBItem(it.description));
  const seeds = sectionBLinesForService(serviceType, {
    rushWaived: preservedRushWaived,
  });
  if (seeds.length === 0) return without.length > 0 ? without : items;

  const injected = seeds.map((seed) => {
    const base = {
      id: createId(),
      description: seed.description,
      quantity: seed.quantity,
      unitPrice: seed.unitPrice,
      amount: seed.amount,
      // Section B lines are optional add-ons — never mark as included package
      isIncluded: false,
      category: "included_meta" as const,
    };
    return base as unknown as T;
  });

  // Keep a blank starter row if the form would otherwise be empty before inject
  const core =
    without.length === 0 ||
    (without.length === 1 && !String(without[0]?.description ?? "").trim())
      ? []
      : without;

  return [...core, ...injected];
}

/**
 * Strikethrough waive is only for priced Section B options (e.g. B2 快速交相).
 * Regular lines (寵物攝影 / extra hour / transport / …) never show 劃線豁免.
 */
export function canToggleQuoteWaive(item: {
  description?: string | null;
  unitPrice?: number | string | null;
  category?: string | null;
}): boolean {
  if (isQuoteSectionHeader(item.description)) return false;
  if (!isQuoteSectionBOptionItem(item.description)) return false;
  if (
    resolveQuoteLineItemKind({
      description: item.description,
      category: item.category,
    }) === "transport"
  ) {
    return false;
  }
  return Number(item.unitPrice) > 0;
}

/**
 * Toggle one line between charged (amount = qty * unitPrice) and waived
 * (amount = 0, unitPrice kept for strikethrough display).
 */
export function toggleQuoteItemWaived<T extends ItemLike>(
  items: T[],
  index: number
): T[] {
  if (index < 0 || index >= items.length) return items;
  const target = items[index]!;
  if (!canToggleQuoteWaive(target)) return items;

  const unitPrice = Number(target.unitPrice);
  const rawQty = Number(target.quantity);
  const currentlyWaived = isQuoteWaivedPrice(
    unitPrice,
    Number(target.amount),
    rawQty
  );
  // Waive display needs qty ≥ 1; unselected options (qty 0) become selected when waived
  const qty = rawQty > 0 ? rawQty : 1;

  return items.map((it, i) => {
    if (i !== index) return it;
    return {
      ...it,
      unitPrice,
      quantity: qty,
      amount: currentlyWaived ? Math.round(unitPrice * qty * 100) / 100 : 0,
      isIncluded: false,
    };
  });
}

/** @deprecated Prefer toggleQuoteItemWaived — kept for event B2 convenience. */
export function toggleEventRushWaived<T extends ItemLike>(items: T[]): T[] {
  const idx = items.findIndex((it) => isEventRushFeeItem(it.description));
  if (idx < 0) return items;
  return toggleQuoteItemWaived(items, idx);
}
