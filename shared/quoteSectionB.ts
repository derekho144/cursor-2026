/**
 * Conditional Quote 「SECTION B」 blocks by service type.
 *
 * Food  → 食物攝影與現場食物造型
 * Event → 活動攝影與線上直播（含快速交相 $800 + 劃線豁免）
 *
 * Persistence: plain line items (no DB migration).
 * - Section header: description starts with "SECTION B · …"
 * - Managed lines: description starts with B1 / B1.1 / B2
 * - Waived rush fee: unitPrice > 0 && amount === 0 (print shows strikethrough)
 */

export const EVENT_RUSH_FEE_HKD = 800;

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

const FOOD_SECTION_TITLE = "SECTION B · 食物攝影與現場食物造型";
const EVENT_SECTION_TITLE = "SECTION B · 活動攝影與線上直播";

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

export function isQuoteTbdPrice(description: string | null | undefined, unitPrice: number): boolean {
  if (Number(unitPrice) !== 0) return false;
  return /報價另議|tbd|to be (decided|advised|quoted)/i.test(String(description ?? ""));
}

/** List price shown with strikethrough; amount must stay 0 so totals exclude it. */
export function isQuoteWaivedPrice(unitPrice: number, amount: number): boolean {
  return Number(unitPrice) > 0 && Number(amount) === 0;
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
      description: "B1 拍攝前期策劃\n拍攝概念、Moodboard、及道具建議",
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    },
    {
      code: "B1.1",
      description:
        "B1.1 現場藝術指導及食物造型（2 day · 9 hours per day）\n報價另議",
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    },
  ];
}

export function buildEventSectionBLines(opts?: {
  /** When true, rush fee shows strikethrough / 豁免 (amount 0). Default charged. */
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
      description: "B1 QRCODE 相片直播",
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    },
    {
      code: "B2",
      description: "B2 快速交相（12小時內）",
      quantity: 1,
      unitPrice: EVENT_RUSH_FEE_HKD,
      amount: waived ? 0 : EVENT_RUSH_FEE_HKD,
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
      isQuoteWaivedPrice(Number(it.unitPrice), Number(it.amount))
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
      isIncluded: seed.unitPrice === 0 && seed.amount === 0 && !isQuoteSectionHeader(seed.description),
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

/** Toggle event B2 between charged ($800) and waived (strikethrough). */
export function toggleEventRushWaived<T extends ItemLike>(items: T[]): T[] {
  return items.map((it) => {
    if (!isEventRushFeeItem(it.description)) return it;
    const unitPrice = Number(it.unitPrice) > 0 ? Number(it.unitPrice) : EVENT_RUSH_FEE_HKD;
    const currentlyWaived = isQuoteWaivedPrice(unitPrice, Number(it.amount));
    return {
      ...it,
      unitPrice,
      quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
      amount: currentlyWaived ? unitPrice : 0,
      isIncluded: false,
    };
  });
}
