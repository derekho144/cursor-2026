import {
  looksLikeFlatPackageLineItem,
  reconcileHourlyQuoteItems,
} from "../shared/quoteItemHours";

export type InquiryQuoteDraftItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  category?:
    | "photographer_crew"
    | "photobooth"
    | "video"
    | "transport"
    | "included_meta"
    | "other";
  sortOrder?: number;
};

const INCLUDED_RETOUCH_DESCRIPTION =
  "Retouch (Post image editing included fine retouch of lighting, colour, sharpen, dust)";

const INCLUDED_RETOUCH_SERVICES = new Set([
  "corporate_event",
  "party_family_event",
  "product",
  "food_beverage",
  "jewelry",
]);

const HOURLY_PHOTO_SERVICES = new Set([
  "corporate_event",
  "party_family_event",
  "interior",
  "portrait",
]);

function positiveNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasRetouchLine(items: InquiryQuoteDraftItem[]): boolean {
  return items.some((item) =>
    /retouch|修圖|後期|image\s*editing|photo\s*editing/i.test(
      item.description,
    ),
  );
}

function hasTransportLine(items: InquiryQuoteDraftItem[]): boolean {
  return items.some((item) =>
    /transport|交通|運輸|車費/i.test(item.description),
  );
}

function isPrimaryPhotographyLine(item: InquiryQuoteDraftItem): boolean {
  const description = item.description;
  if (
    /retouch|修圖|transport|交通|transportation|video|videography|錄影|影片|post[- ]?production|editing|equipment|lighting/i.test(
      description,
    )
  ) {
    return false;
  }
  return /photo|photography|photoshoot|photographer|攝影|拍攝|拍照/i.test(
    description,
  );
}

function normalizeRawItems(rawItems: unknown): InquiryQuoteDraftItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      const description = String(item.description ?? "").trim();
      if (!description) return null;
      const quantity = Math.max(0, positiveNumber(item.quantity, 1));
      const unitPrice = Math.max(0, positiveNumber(item.unitPrice, 0));
      return {
        description,
        quantity,
        unitPrice,
        amount: quantity * unitPrice,
        ...(item.category ? { category: item.category as InquiryQuoteDraftItem["category"] } : {}),
      } satisfies InquiryQuoteDraftItem;
    })
    .filter((item): item is InquiryQuoteDraftItem => item !== null);
}

/**
 * Make the AI's suggested items safe for quote creation without changing prices.
 * The function only corrects quantities from explicit hours and adds zero-priced
 * included rows that the normal JD quote template always shows.
 */
export function normalizeInquiryQuoteItems(
  rawItems: unknown,
  serviceType: string,
  shootHours?: unknown,
): InquiryQuoteDraftItem[] {
  let items = normalizeRawItems(rawItems);
  const hours = positiveNumber(shootHours, 0);

  if (HOURLY_PHOTO_SERVICES.has(serviceType)) {
    items = reconcileHourlyQuoteItems(serviceType, items).items;

    // The email parser may know the hours even when the LLM omitted them from
    // the line description. Align the primary photography row deterministically.
    if (hours > 0) {
      const index = items.findIndex(isPrimaryPhotographyLine);
      if (index >= 0) {
        const item = items[index]!;
        if (
          item.unitPrice > 0 &&
          !looksLikeFlatPackageLineItem(item, hours)
        ) {
          const hasHoursInDescription =
            /\b\d+(?:\.\d+)?\s*(?:hours?|hrs?)\b|\d+(?:\.\d+)?\s*(?:小時|小时)/i.test(
              item.description,
            );
          items[index] = {
            ...item,
            description: hasHoursInDescription
              ? item.description
              : `${item.description} (${hours} hours)`,
            quantity: hours,
            amount: hours * item.unitPrice,
          };
        }
      }
    }
  }

  if (items.length === 0) {
    items.push({
      description: "Photography Service",
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    });
  }

  // Accepted JD quotes show the included retouching scope explicitly. It is a
  // HK$0 informational row, so this does not increase the quote total.
  if (INCLUDED_RETOUCH_SERVICES.has(serviceType) && !hasRetouchLine(items)) {
    items.push({
      description: INCLUDED_RETOUCH_DESCRIPTION,
      quantity: 1,
      unitPrice: 0,
      amount: 0,
      category: "included_meta",
    });
  }

  // Event quotes always show the fixed transportation line, even when the AI
  // omitted it. Keep this deterministic and price-neutral only when present.
  if (
    (serviceType === "corporate_event" || serviceType === "party_family_event") &&
    !hasTransportLine(items)
  ) {
    items.push({
      description: "Transportation Fee",
      quantity: 1,
      unitPrice: 320,
      amount: 320,
      category: "transport",
    });
  }

  return items.map((item, index) => ({
    ...item,
    amount: Math.max(0, item.quantity) * Math.max(0, item.unitPrice),
    sortOrder: index,
  }));
}

/** Build the final item list used by both auto-draft and manual approval. */
export function buildInquiryQuoteItems(
  parsed: Record<string, unknown> | null | undefined,
): InquiryQuoteDraftItem[] {
  const data = parsed ?? {};
  const serviceType = String(data.serviceType ?? "other");
  return normalizeInquiryQuoteItems(
    data.suggestedItems,
    serviceType,
    data.shootHours,
  );
}

export { INCLUDED_RETOUCH_DESCRIPTION };
