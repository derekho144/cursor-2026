/**
 * Quote pricing fundamentals differ by service type:
 * - time_crew: hours + manpower (events, video, etc.)
 * - shot_count: delivered photo count 張數 (product / still-life)
 * - design: neither (graphic / web / menu)
 */

export const DESIGN_SERVICE_TYPES = new Set([
  "graphic_design",
  "web_development",
  "menu_design",
]);

/** Still-life / product-style quotes priced primarily by delivered shots. */
export const SHOT_COUNT_SERVICE_TYPES = new Set([
  "product",
  "food_beverage",
  "jewelry",
  "artwork",
  "ai_photography",
]);

/**
 * Excluded from pricing learning / win-rate / suggest.
 * "other" is too mixed to learn from.
 */
export const PRICING_LEARNING_EXCLUDED_TYPES = new Set(["other"]);

export function isPricingLearningServiceType(serviceType: string): boolean {
  return !PRICING_LEARNING_EXCLUDED_TYPES.has(serviceType);
}

export type QuotePricingMode = "design" | "shot_count" | "time_crew";

export function quotePricingMode(serviceType: string): QuotePricingMode {
  if (DESIGN_SERVICE_TYPES.has(serviceType)) return "design";
  if (SHOT_COUNT_SERVICE_TYPES.has(serviceType)) return "shot_count";
  return "time_crew";
}

export type ShotCountBucket =
  | "unknown"
  | "lte_10"
  | "n11_20"
  | "n21_50"
  | "gt_50";

export function shotCountBucket(n: number | null | undefined): ShotCountBucket {
  if (n == null || !Number.isFinite(n) || n <= 0) return "unknown";
  if (n <= 10) return "lte_10";
  if (n <= 20) return "n11_20";
  if (n <= 50) return "n21_50";
  return "gt_50";
}

export function shotCountBucketLabel(bucket: ShotCountBucket): string {
  switch (bucket) {
    case "lte_10":
      return "≤ 10 張";
    case "n11_20":
      return "11–20 張";
    case "n21_50":
      return "21–50 張";
    case "gt_50":
      return "> 50 張";
    default:
      return "張數未標明";
  }
}
