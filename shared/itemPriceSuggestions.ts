/**
 * Per–line-item price suggestions from comparable accepted quotes.
 * Only returns rows that have a usable suggestedUnitPrice (no “insufficient data” placeholders).
 */
import { classifyQuoteLineItem } from "./quoteLineItemKind";
import { isQuoteSectionHeader } from "./quoteSectionB";

export const FIXED_TRANSPORTATION_FEE_HKD = 320;

/** Minimum accepted line matches before showing a learned unit price. */
export const MIN_ITEM_PRICE_SAMPLES = 2;

export type ItemSuggestInput = {
  description: string;
  quantity: number;
  category?: string | null;
};

export type HistoricalLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  category?: string | null;
};

export type HistoricalQuoteForItems = {
  status: "accepted" | "rejected";
  items: HistoricalLineItem[];
};

export type ItemPriceSuggestion = {
  description: string;
  quantity: number;
  suggestedUnitPrice: number;
  lowUnitPrice: number;
  highUnitPrice: number;
  winRate: number | null;
  sampleCount: number;
  confidence: "high" | "medium" | "low";
  matchedBy: string;
  note: string | null;
};

function normDesc(description: string): string {
  return String(description ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function quantityBucket(q: number): string {
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 10) return "6-10";
  if (n <= 20) return "11-20";
  if (n <= 50) return "21-50";
  return "50+";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function summarizeUnitPrices(vals: number[]): {
  count: number;
  p25: number;
  p50: number;
  p75: number;
} {
  const sorted = vals.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, p25: 0, p50: 0, p75: 0 };
  return {
    count: sorted.length,
    p25: Math.round(percentile(sorted, 0.25)),
    p50: Math.round(percentile(sorted, 0.5)),
    p75: Math.round(percentile(sorted, 0.75)),
  };
}

function confidenceFromCount(count: number): "high" | "medium" | "low" {
  if (count >= 8) return "high";
  if (count >= 4) return "medium";
  return "low";
}

function isFixedTransport(description: string): boolean {
  return classifyQuoteLineItem(description) === "transport";
}

/**
 * Build per-item suggestions. Skips section headers and items without enough
 * accepted history (or a fixed ops rule). Never emits placeholder “人手定價” rows.
 */
export function buildItemPriceSuggestions(input: {
  items: ItemSuggestInput[];
  history: HistoricalQuoteForItems[];
}): ItemPriceSuggestion[] {
  const accepted = input.history.filter((h) => h.status === "accepted");
  const decided = input.history.filter(
    (h) => h.status === "accepted" || h.status === "rejected"
  );
  const out: ItemPriceSuggestion[] = [];

  for (const item of input.items) {
    const description = String(item.description ?? "").trim();
    if (!description || isQuoteSectionHeader(description)) continue;

    const quantity = Number(item.quantity) || 0;

    if (isFixedTransport(description)) {
      out.push({
        description,
        quantity,
        suggestedUnitPrice: FIXED_TRANSPORTATION_FEE_HKD,
        lowUnitPrice: FIXED_TRANSPORTATION_FEE_HKD,
        highUnitPrice: FIXED_TRANSPORTATION_FEE_HKD,
        winRate: null,
        sampleCount: 0,
        confidence: "high",
        matchedBy: "固定營運規則",
        note: null,
      });
      continue;
    }

    const key = normDesc(description);
    const qb = quantityBucket(quantity);

    const collect = (rows: HistoricalQuoteForItems[], mode: "exact" | "qty" | "any") => {
      const prices: number[] = [];
      for (const row of rows) {
        for (const li of row.items) {
          if (normDesc(li.description) !== key) continue;
          const up = Number(li.unitPrice);
          if (!Number.isFinite(up) || up < 0) continue;
          if (mode === "exact" && Number(li.quantity) !== quantity) continue;
          if (mode === "qty" && quantityBucket(Number(li.quantity)) !== qb) continue;
          prices.push(up);
        }
      }
      return prices;
    };

    let prices = collect(accepted, "exact");
    let matchedBy = "同名同數量成交";
    if (prices.length < MIN_ITEM_PRICE_SAMPLES) {
      prices = collect(accepted, "qty");
      matchedBy = "同名同數量級距成交";
    }
    if (prices.length < MIN_ITEM_PRICE_SAMPLES) {
      prices = collect(accepted, "any");
      matchedBy = "同名項目成交";
    }
    if (prices.length < MIN_ITEM_PRICE_SAMPLES) {
      // Insufficient — omit row entirely (do not show “人手定價” placeholders).
      continue;
    }

    const summary = summarizeUnitPrices(prices);

    // Win rate: decided quotes that contain this line description
    let decidedWith = 0;
    let acceptedWith = 0;
    for (const row of decided) {
      const has = row.items.some((li) => normDesc(li.description) === key);
      if (!has) continue;
      decidedWith += 1;
      if (row.status === "accepted") acceptedWith += 1;
    }
    const winRate =
      decidedWith >= 3
        ? Math.round((acceptedWith / decidedWith) * 1000) / 10
        : null;

    out.push({
      description,
      quantity,
      suggestedUnitPrice: summary.p50,
      lowUnitPrice: summary.p25,
      highUnitPrice: summary.p75,
      winRate,
      sampleCount: summary.count,
      confidence: confidenceFromCount(summary.count),
      matchedBy,
      note: null,
    });
  }

  return out;
}
